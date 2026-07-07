"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { Id } from "./_generated/dataModel";

// Whisper rejects files over 25 MB; guard so long recordings fail clearly
// (and don't OOM the action) rather than 413ing deep in the pipeline.
const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

// fetch with a hard timeout so a hung external API can't wedge the action.
async function fetchWithTimeout(url: string, opts: RequestInit, ms: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const transcribeAndGenerateNotes = action({
  args: {
    notesId: v.id("meetingNotes"),
    meetingId: v.id("meetings"),
    audioDownloadUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { notesId, meetingId } = args;

    try {
      // 1. Get the meeting notes record
      const notes = await ctx.runQuery(api.meetingNotes.get, { notesId });
      if (!notes) {
        throw new Error("Meeting notes not found");
      }

      const meeting = await ctx.runQuery(api.meetings.get, { meetingId });
      if (!meeting) {
        throw new Error("Meeting not found");
      }

      // 2. Get audio URL — prefer client-provided presigned URL, fall back to Convex storage
      let audioUrl: string | null = args.audioDownloadUrl || null;

      if (!audioUrl && notes.audioFileId) {
        audioUrl = await ctx.storage.getUrl(notes.audioFileId);
      }

      if (!audioUrl) {
        throw new Error("No audio URL available. Please try again.");
      }

      const audioResponse = await fetchWithTimeout(audioUrl, {}, 60000);
      if (!audioResponse.ok) {
        throw new Error(`Failed to fetch audio: ${audioResponse.statusText}`);
      }

      const audioBuffer = await audioResponse.arrayBuffer();
      if (audioBuffer.byteLength > MAX_AUDIO_BYTES) {
        throw new Error(
          `Recording too large to transcribe (${(audioBuffer.byteLength / 1048576).toFixed(0)} MB exceeds the 25 MB limit).`
        );
      }

      // 3. Transcribe with OpenAI Whisper API
      await ctx.runMutation(internal.meetingNotes.internalUpdateStatus, {
        notesId,
        status: "transcribing",
      });

      let transcript: string;

      if (!process.env.OPENAI_API_KEY) {
        console.error("OPENAI_API_KEY not configured - using placeholder transcript");
        transcript = "[Transcription unavailable - OPENAI_API_KEY not configured. Audio was recorded successfully.]";
      } else {
        // Build multipart form data manually (Blob/FormData unavailable in Convex runtime)
        const boundary = "----ConvexBoundary" + Date.now().toString(36);
        const audioBytes = new Uint8Array(audioBuffer);

        const parts: Uint8Array[] = [];
        const enc = new TextEncoder();

        // File part
        parts.push(enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="meeting-audio.webm"\r\nContent-Type: audio/webm\r\n\r\n`
        ));
        parts.push(audioBytes);
        parts.push(enc.encode("\r\n"));

        // Model part
        parts.push(enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nwhisper-1\r\n`
        ));

        // Response format part
        parts.push(enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="response_format"\r\n\r\ntext\r\n`
        ));

        // Language part
        parts.push(enc.encode(
          `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nen\r\n`
        ));

        // Closing boundary
        parts.push(enc.encode(`--${boundary}--\r\n`));

        // Concatenate all parts
        const totalLength = parts.reduce((sum, p) => sum + p.length, 0);
        const body = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
          body.set(part, offset);
          offset += part.length;
        }

        const whisperResponse = await fetchWithTimeout(
          "https://api.openai.com/v1/audio/transcriptions",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
            },
            body: body,
          },
          120000
        );

        if (!whisperResponse.ok) {
          const errorText = await whisperResponse.text();
          throw new Error(`Whisper API error: ${whisperResponse.status} - ${errorText}`);
        }

        transcript = await whisperResponse.text();
      }

      // 4. Store the transcript
      await ctx.runMutation(internal.meetingNotes.internalUpdateTranscript, {
        notesId,
        transcript,
      });

      // 5. Generate AI notes with Claude
      if (!process.env.ANTHROPIC_API_KEY) {
        console.error("ANTHROPIC_API_KEY not configured - skipping note generation");
        await ctx.runMutation(internal.meetingNotes.internalUpdateNotes, {
          notesId,
          summary: "AI note generation unavailable - ANTHROPIC_API_KEY not configured.",
          actionItems: [],
          decisions: [],
          followUps: [],
          keyTopics: [],
        });
      } else {
        const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

        const prompt = `You are an AI meeting assistant. Analyze the following meeting transcript and generate comprehensive meeting notes.

MEETING TITLE: ${meeting.title}
MEETING DATE: ${new Date(meeting.startedAt || meeting.createdAt).toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
${notes.duration ? `DURATION: ${Math.floor(notes.duration / 60)} minutes` : ""}

TRANSCRIPT:
${transcript}

Generate meeting notes in the following JSON format:
{
  "summary": "A comprehensive 2-3 paragraph summary of the meeting, covering the main topics discussed, key points made, and overall outcome.",
  "actionItems": [
    {
      "text": "Description of the action item",
      "assignee": "Name of person responsible (if mentioned, otherwise null)",
      "dueDate": "Due date if mentioned (e.g., 'March 25, 2026'), otherwise null"
    }
  ],
  "decisions": ["Decision 1 that was made", "Decision 2 that was made"],
  "followUps": ["Follow-up item 1", "Follow-up item 2"],
  "keyTopics": ["Topic 1", "Topic 2", "Topic 3"]
}

IMPORTANT RULES:
1. Be thorough but concise in the summary
2. Extract ALL action items mentioned, even implicit ones
3. Include assignees and due dates only when explicitly mentioned
4. Capture all decisions that were agreed upon
5. List follow-up items that need attention after the meeting
6. Identify 3-8 key topics that were discussed
7. If the transcript is very short or unclear, do your best with available information
8. Return ONLY valid JSON, no other text`;

        try {
          // Call Anthropic API directly (SDK has bundling issues in Convex)
          const claudeResponse = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-6",
              max_tokens: 4096,
              messages: [{ role: "user", content: prompt }],
            }),
          }, 90000);

          if (!claudeResponse.ok) {
            const errText = await claudeResponse.text();
            throw new Error(`Claude API error: ${claudeResponse.status} - ${errText}`);
          }

          const response = await claudeResponse.json();
          const content = response.content?.[0];
          if (!content || content.type !== "text") {
            throw new Error("Unexpected response type from Claude");
          }

          // Parse JSON response
          const jsonMatch = content.text.match(/\{[\s\S]*\}/);
          if (!jsonMatch) {
            throw new Error("Could not parse notes from Claude response");
          }

          const generatedNotes = JSON.parse(jsonMatch[0]);

          // Store the generated notes
          await ctx.runMutation(internal.meetingNotes.internalUpdateNotes, {
            notesId,
            summary: generatedNotes.summary || "No summary generated.",
            actionItems: (generatedNotes.actionItems || []).map(
              (item: { text: string; assignee?: string | null; dueDate?: string | null }) => ({
                text: item.text,
                assignee: item.assignee || undefined,
                dueDate: item.dueDate || undefined,
                completed: false,
              })
            ),
            decisions: generatedNotes.decisions || [],
            followUps: generatedNotes.followUps || [],
            keyTopics: generatedNotes.keyTopics || [],
          });
        } catch (aiError) {
          console.error("Claude note generation failed:", aiError);
          // Surface the failure via error status instead of marking the notes
          // "complete" with zero action items (which looked like a real, successful
          // meeting that simply had none — silently dropping the AI output).
          await ctx.runMutation(internal.meetingNotes.internalUpdateStatus, {
            notesId,
            status: "error",
            errorMessage:
              "AI note generation failed — the transcript is available, but notes and action items could not be generated. You can retry.",
          });
          return;
        }
      }

      // 6. Send notification to all meeting participants
      const participants = await ctx.runQuery(
        api.meetingParticipants.getByMeeting,
        { meetingId }
      );

      if (participants) {
        for (const participant of participants) {
          if (participant.userId) {
            try {
              await ctx.runMutation(api.notifications.create, {
                userId: participant.userId as Id<"users">,
                type: "meeting_notes",
                title: "Meeting Notes Ready",
                message: `AI-generated notes for "${meeting.title}" are now available.`,
                link: `/meetings/notes/${meetingId}`,
              });
            } catch (err) {
              console.error(
                "Failed to send notification to participant:",
                participant.userId,
                err
              );
            }
          }
        }
      }
    } catch (error) {
      console.error("transcribeAndGenerateNotes failed:", error);
      await ctx.runMutation(internal.meetingNotes.internalUpdateStatus, {
        notesId,
        status: "error",
        errorMessage:
          error instanceof Error ? error.message : "Unknown error occurred",
      });
    }
  },
});

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";

export const maxDuration = 60;

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are the Tech Wizard, an expert IT and networking assistant for IE Central (Import Export Tire Company), a tire and industrial equipment company. You specialize in:

**Core Expertise:**
- Network infrastructure (switches, routers, firewalls, VLANs, VPNs)
- Windows Server administration (Active Directory, Group Policy, DNS, DHCP)
- Microsoft 365 administration (Exchange, Teams, SharePoint, Entra ID)
- Workstation troubleshooting and deployment
- Printer and scanner configuration
- Security best practices and incident response
- Cloud services (Azure, AWS basics)
- Backup and disaster recovery
- Remote access solutions
- VoIP and phone systems

**Company Context:**
- IE Central operates multiple warehouse locations
- Uses a mix of Windows workstations and warehouse scanning devices
- Has thermal label printers for warehouse operations
- Uses Convex for their internal dashboard database
- Next.js/React for their web applications
- QuickBooks Desktop for accounting

**Communication Style:**
- Be concise but thorough
- Provide step-by-step instructions when applicable
- Include relevant commands, scripts, or configurations
- Warn about potential risks before suggesting changes
- Suggest best practices proactively
- Use technical terminology appropriately but explain complex concepts
- Format responses with markdown for readability

**Important:**
- Always consider security implications
- Recommend testing in non-production environments first
- Provide rollback steps when suggesting changes
- If you're unsure about something specific to their environment, ask clarifying questions`;

interface Message {
  role: "user" | "assistant";
  content: string;
}

export async function POST(request: NextRequest) {
  try {
    const { messages, userEmail } = await request.json();

    if (!messages || !Array.isArray(messages)) {
      return NextResponse.json(
        { error: "Messages array is required" },
        { status: 400 }
      );
    }

    // Convert messages to Anthropic format
    const anthropicMessages = messages.map((msg: Message) => ({
      role: msg.role as "user" | "assistant",
      content: msg.content,
    }));

    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 4096,
      system: SYSTEM_PROMPT,
      messages: anthropicMessages,
    });

    // Extract text from response
    const assistantMessage =
      response.content[0].type === "text" ? response.content[0].text : "";

    return NextResponse.json({
      message: assistantMessage,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (error: any) {
    console.error("Tech Wizard API error:", error);
    return NextResponse.json(
      { error: error.message || "Failed to get response from Tech Wizard" },
      { status: 500 }
    );
  }
}

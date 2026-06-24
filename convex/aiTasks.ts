"use node";

import { action } from "./_generated/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import Anthropic from "@anthropic-ai/sdk";

// Generate tasks from a project description using AI
export const generateTasks = action({
  args: {
    projectId: v.id("projects"),
    projectName: v.string(),
    projectDescription: v.string(),
  },
  handler: async (ctx, args): Promise<{
    success: boolean;
    tasks?: Array<{
      title: string;
      description?: string;
      estimatedMinutes?: number;
    }>;
    error?: string;
  }> => {
    const { projectId, projectName, projectDescription } = args;

    // Check if Anthropic API key is configured
    if (!process.env.ANTHROPIC_API_KEY) {
      console.error("ANTHROPIC_API_KEY not configured - using fallback");
      return {
        success: true,
        tasks: generateFallbackTasks(projectDescription),
      };
    }

    try {
      const anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });

      const prompt = `You are a project manager helping to break down a software development project into actionable tasks.

PROJECT NAME: ${projectName}

PROJECT DESCRIPTION:
${projectDescription}

Based on this project description, generate a list of specific, actionable tasks that need to be completed.
Each task should be:
- Clear and specific
- Achievable in a reasonable amount of time (15 minutes to 4 hours)
- Ordered from first to last in terms of what should be done first

Return your response as a JSON object with this exact structure:
{
  "tasks": [
    {
      "title": "Task title here",
      "description": "Optional longer description of what needs to be done",
      "estimatedMinutes": 60
    }
  ]
}

Guidelines:
- Generate between 3-10 tasks depending on project complexity
- Use action verbs (Create, Implement, Add, Set up, Configure, Test, etc.)
- estimatedMinutes should be realistic (15, 30, 60, 90, 120, 180, 240 are good values)
- description is optional but helpful for complex tasks
- Keep task titles concise but descriptive

Return ONLY the JSON object, no other text.`;

      const response = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 2000,
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });

      // Extract text content
      const textContent = response.content.find((c) => c.type === "text");
      if (!textContent || textContent.type !== "text") {
        throw new Error("No text response from AI");
      }

      // Parse the JSON response
      let parsedResponse;
      try {
        // Try to extract JSON from the response (in case there's extra text)
        const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsedResponse = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON found in response");
        }
      } catch (parseError) {
        console.error("Failed to parse AI response:", textContent.text);
        throw new Error("Failed to parse AI response as JSON");
      }

      // Validate the response structure
      if (!parsedResponse.tasks || !Array.isArray(parsedResponse.tasks)) {
        throw new Error("Invalid response structure: missing tasks array");
      }

      // Create the tasks in the database
      const validTasks = parsedResponse.tasks
        .filter((task: any) => task.title && typeof task.title === "string")
        .map((task: any) => ({
          title: task.title,
          description: task.description || undefined,
          estimatedMinutes: typeof task.estimatedMinutes === "number" ? task.estimatedMinutes : undefined,
        }));

      if (validTasks.length === 0) {
        throw new Error("No valid tasks generated");
      }

      // Batch create the tasks
      await ctx.runMutation(api.tasks.createBatch, {
        projectId,
        tasks: validTasks,
      });

      console.log(`Generated ${validTasks.length} tasks for project ${projectName}`);

      return {
        success: true,
        tasks: validTasks,
      };
    } catch (error: any) {
      console.error("Error generating tasks:", error);
      return {
        success: false,
        error: error?.message || "Failed to generate tasks",
      };
    }
  },
});

// Fallback task generation when AI is unavailable
function generateFallbackTasks(description: string): Array<{
  title: string;
  description?: string;
  estimatedMinutes?: number;
}> {
  // Simple keyword-based task generation
  const tasks: Array<{ title: string; description?: string; estimatedMinutes?: number }> = [];

  const descLower = description.toLowerCase();

  // Always add setup task
  tasks.push({
    title: "Set up project structure",
    description: "Initialize the project and create basic file structure",
    estimatedMinutes: 30,
  });

  // Add tasks based on keywords
  if (descLower.includes("api") || descLower.includes("backend") || descLower.includes("endpoint")) {
    tasks.push({
      title: "Design API endpoints",
      description: "Plan and document the API structure",
      estimatedMinutes: 60,
    });
    tasks.push({
      title: "Implement API logic",
      estimatedMinutes: 120,
    });
  }

  if (descLower.includes("ui") || descLower.includes("frontend") || descLower.includes("interface") || descLower.includes("page")) {
    tasks.push({
      title: "Create UI components",
      description: "Build the user interface components",
      estimatedMinutes: 120,
    });
  }

  if (descLower.includes("database") || descLower.includes("schema") || descLower.includes("data")) {
    tasks.push({
      title: "Design database schema",
      estimatedMinutes: 60,
    });
  }

  if (descLower.includes("auth") || descLower.includes("login") || descLower.includes("user")) {
    tasks.push({
      title: "Implement authentication",
      estimatedMinutes: 90,
    });
  }

  // Always add testing and review
  tasks.push({
    title: "Test functionality",
    description: "Test all implemented features",
    estimatedMinutes: 60,
  });

  tasks.push({
    title: "Code review and cleanup",
    estimatedMinutes: 30,
  });

  return tasks;
}

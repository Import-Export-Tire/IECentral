import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // ============ AUTHENTICATION ============
  users: defineTable({
    email: v.optional(v.string()),
    passwordHash: v.optional(v.string()),
    name: v.string(),
    title: v.optional(v.string()), // Job title (e.g. "Warehouse Supervisor", "Shipping Clerk") - for tracking positions alongside permissions
    role: v.string(), // "super_admin" | "admin" | "warehouse_director" | "warehouse_manager" | "office_manager" | "retail_manager" | "retail_store_manager" | "department_manager" | "shift_lead" | "retail_associate" | "payroll_manager" | "employee" | "member"
    isActive: v.boolean(),
    forcePasswordChange: v.optional(v.boolean()),
    // Role-specific fields
    managedDepartments: v.optional(v.array(v.string())), // For department_manager - which departments they manage
    managedLocationIds: v.optional(v.array(v.id("locations"))), // For warehouse_manager - which locations they manage
    personnelId: v.optional(v.id("personnel")), // For employee role - links to their personnel record
    // Reporting structure
    reportsTo: v.optional(v.id("users")), // Who this user reports to (their manager)
    // Push notification token for mobile app
    expoPushToken: v.optional(v.string()),
    // Daily activity log requirement
    requiresDailyLog: v.optional(v.boolean()), // Admin-configurable per user
    // Time & Payroll flags (floating permissions - RBAC)
    isFinalTimeApprover: v.optional(v.boolean()), // Can do final time approval after T2 location approval
    isPayrollProcessor: v.optional(v.boolean()), // Can export payroll data
    // Feature-level permission overrides (three-state: undefined=use role default, true=grant, false=deny)
    permissionOverrides: v.optional(v.record(v.string(), v.boolean())),
    // Email client access
    hasEmailAccess: v.optional(v.boolean()),
    createdAt: v.optional(v.number()),
    lastLoginAt: v.optional(v.number()),
    // Legacy fields from old system
    base44Id: v.optional(v.string()),
    empId: v.optional(v.string()),
    locationId: v.optional(v.string()),
    locationName: v.optional(v.string()),
    pin: v.optional(v.string()),
  })
    .index("by_email", ["email"])
    .index("by_personnel", ["personnelId"])
    .index("by_reports_to", ["reportsTo"]),

  // ============ SYSTEM BANNERS ============
  systemBanners: defineTable({
    message: v.string(),
    type: v.string(), // "info" | "warning" | "error" | "success"
    isActive: v.boolean(),
    showOnMobile: v.boolean(),
    showOnDesktop: v.boolean(),
    dismissible: v.boolean(), // Can users dismiss it?
    linkUrl: v.optional(v.string()), // Optional link
    linkText: v.optional(v.string()), // Optional link text
    expiresAt: v.optional(v.number()), // Auto-expire timestamp
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"]),

  // ============ PROJECT MANAGEMENT ============
  projects: defineTable({
    name: v.string(),
    description: v.string(),
    status: v.string(), // "backlog" | "in_progress" | "review" | "done" | "archived"
    priority: v.string(), // "low" | "medium" | "high" | "urgent"
    createdBy: v.id("users"),
    assignedTo: v.optional(v.id("users")),
    // Access control - who can view this project besides owner
    sharedWith: v.optional(v.array(v.id("users"))), // Users who can view this project
    visibility: v.optional(v.string()), // "private" | "team" | "public" - defaults to "private"
    estimatedHours: v.optional(v.number()),
    actualHours: v.optional(v.number()),
    dueDate: v.optional(v.string()),
    aiGeneratedSteps: v.optional(v.string()), // JSON stringified array
    aiTimelineAnalysis: v.optional(
      v.object({
        estimatedCompletion: v.string(),
        isOnSchedule: v.boolean(),
        behindByDays: v.optional(v.number()),
        confidence: v.number(),
        reasoning: v.string(),
      })
    ),
    repositoryId: v.optional(v.id("repositories")),
    doneAt: v.optional(v.number()), // Timestamp when marked as done
    archivedAt: v.optional(v.number()), // Timestamp when archived
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_assignee", ["assignedTo"])
    .index("by_created", ["createdAt"])
    .index("by_owner", ["createdBy"]),

  tasks: defineTable({
    projectId: v.id("projects"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.string(), // "todo" | "in_progress" | "done"
    order: v.number(),
    estimatedMinutes: v.optional(v.number()),
    actualMinutes: v.optional(v.number()),
    assignedTo: v.optional(v.id("users")),
    createdBy: v.optional(v.id("users")),
    dueDate: v.optional(v.string()),
    createdAt: v.number(),
    completedAt: v.optional(v.number()),
  })
    .index("by_project", ["projectId"])
    .index("by_status", ["status"])
    .index("by_assigned", ["assignedTo"]),

  // Project Progress Notes
  projectNotes: defineTable({
    projectId: v.id("projects"),
    content: v.string(), // The note content (can include @mentions like @userId)
    mentions: v.array(v.id("users")), // Users mentioned in this note
    createdBy: v.id("users"),
    createdByName: v.string(), // Cached for display
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_created", ["createdAt"]),

  // ============ APPLICATIONS (from ietires.com) ============
  jobs: defineTable({
    title: v.string(),
    location: v.string(), // Primary/default location (kept for backwards compatibility)
    locations: v.optional(v.array(v.string())), // Multiple locations for this job
    type: v.string(), // "Full-time" | "Part-time"
    positionType: v.optional(v.string()), // "hourly" | "salaried" | "management"
    department: v.string(),
    status: v.string(),
    description: v.string(),
    benefits: v.array(v.string()),
    keywords: v.array(v.string()),
    isActive: v.boolean(),
    urgentHiring: v.optional(v.boolean()), // Legacy - now use badgeType
    badgeType: v.optional(v.string()), // "urgently_hiring" | "accepting_applications" | "open_position"
    displayOrder: v.optional(v.number()), // For custom ordering
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_department", ["department"])
    .index("by_status", ["status"])
    .index("by_active", ["isActive"]),

  applications: defineTable({
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    message: v.optional(v.string()),
    resumeText: v.optional(v.string()),
    resumeFileId: v.optional(v.id("_storage")), // Actual PDF file in storage
    appliedJobId: v.optional(v.id("jobs")),
    appliedJobTitle: v.string(),
    appliedLocation: v.optional(v.string()), // Which location the applicant selected
    aiAnalysis: v.optional(
      v.object({
        suggestedJobId: v.optional(v.id("jobs")),
        suggestedJobTitle: v.optional(v.string()),
        matchScore: v.number(),
        allScores: v.array(
          v.object({
            jobId: v.id("jobs"),
            jobTitle: v.string(),
            score: v.number(),
            matchedKeywords: v.array(v.string()),
            reasoning: v.optional(v.string()),
          })
        ),
        extractedSkills: v.array(v.string()),
        summary: v.optional(v.string()),
      })
    ),
    candidateAnalysis: v.optional(
      v.object({
        overallScore: v.number(),
        stabilityScore: v.number(),
        experienceScore: v.number(),
        // Graduation date for career stage scoring
        graduationYear: v.optional(v.number()),
        yearsSinceGraduation: v.optional(v.number()),
        employmentHistory: v.array(
          v.object({
            company: v.string(),
            title: v.string(),
            duration: v.string(),
            durationMonths: v.number(),
            startDate: v.optional(v.string()),
            endDate: v.optional(v.string()),
          })
        ),
        redFlags: v.array(
          v.object({
            type: v.string(),
            severity: v.string(),
            description: v.string(),
          })
        ),
        greenFlags: v.array(
          v.object({
            type: v.string(),
            description: v.string(),
          })
        ),
        totalYearsExperience: v.number(),
        averageTenureMonths: v.number(),
        longestTenureMonths: v.number(),
        recommendedAction: v.string(),
        hiringTeamNotes: v.string(),
      })
    ),
    status: v.string(), // "new" | "reviewed" | "contacted" | "scheduled" | "interviewed" | "dns" | "hired" | "rejected"
    source: v.optional(v.string()), // "indeed" | "manual" | "bulk-upload" | "website" - where the application came from
    isArchived: v.optional(v.boolean()), // For archiving rejected applicants
    archivedAt: v.optional(v.number()),
    notes: v.optional(v.string()),
    // Scheduled interview info
    scheduledInterviewDate: v.optional(v.string()), // ISO date string (YYYY-MM-DD)
    scheduledInterviewTime: v.optional(v.string()), // Time string (HH:MM)
    scheduledInterviewLocation: v.optional(v.string()), // "In-person", "Phone", "Video", or custom location
    scheduledInterviewEventId: v.optional(v.id("events")), // Calendar event ID for auto-created event
    // Interview rounds (up to 3)
    interviewRounds: v.optional(
      v.array(
        v.object({
          round: v.number(), // 1, 2, or 3
          interviewerName: v.string(),
          conductedAt: v.number(),
          // Preliminary evaluation (small talk phase) - scores 1-4
          preliminaryEvaluation: v.optional(
            v.object({
              appearance: v.number(), // 1-4: Personal appearance/presentation
              manner: v.number(), // 1-4: Professional demeanor/attitude
              conversation: v.number(), // 1-4: Communication skills
              intelligence: v.number(), // 1-4: Quick thinking/comprehension
              sociability: v.number(), // 1-4: Interpersonal/social skills
              overallHealthOpinion: v.number(), // 1-4: General health/fitness impression
              notes: v.optional(v.string()), // Optional notes from small talk
              evaluatedAt: v.number(), // When evaluation was recorded
            })
          ),
          questions: v.array(
            v.object({
              question: v.string(),
              answer: v.optional(v.string()),
              aiGenerated: v.boolean(),
            })
          ),
          interviewNotes: v.optional(v.string()),
          aiEvaluation: v.optional(
            v.object({
              overallScore: v.number(),
              strengths: v.array(v.string()),
              concerns: v.array(v.string()),
              recommendation: v.string(),
              detailedFeedback: v.string(),
            })
          ),
        })
      )
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_email", ["email"])
    .index("by_status", ["status"])
    .index("by_job", ["appliedJobId"])
    .index("by_created", ["createdAt"]),

  // Application activity tracking for ATS timeline
  applicationActivity: defineTable({
    applicationId: v.id("applications"),
    type: v.string(), // "application_received" | "status_change" | "note_added" | "interview_scheduled" | "interview_completed" | "evaluation_added" | "hired" | "rejected"
    description: v.string(),
    previousValue: v.optional(v.string()), // For status changes
    newValue: v.optional(v.string()),
    performedBy: v.optional(v.id("users")), // Optional for system-generated activities
    performedByName: v.string(),
    metadata: v.optional(v.any()), // Additional context (interview round, score, etc.)
    createdAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_created", ["createdAt"]),

  // ============ MESSAGING ============
  conversations: defineTable({
    type: v.string(), // "direct" | "project" | "group"
    projectId: v.optional(v.id("projects")),
    participants: v.array(v.id("users")),
    // Group chat fields
    name: v.optional(v.string()), // Group name (required for groups, optional for direct)
    createdBy: v.optional(v.id("users")), // Who created the group
    lastMessageAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_project", ["projectId"])
    .index("by_last_message", ["lastMessageAt"]),

  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    content: v.string(),
    mentions: v.array(v.id("users")),
    readBy: v.array(v.id("users")),
    // Emoji reactions: array of { emoji, userId }
    reactions: v.optional(v.array(v.object({
      emoji: v.string(), // The emoji character (e.g., "👍", "❤️", "😂")
      userId: v.id("users"),
      createdAt: v.number(),
    }))),
    // File attachments
    attachments: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      fileName: v.string(),
      fileType: v.string(),
      fileSize: v.number(),
    }))),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId"])
    .index("by_created", ["createdAt"]),

  // Typing indicators for real-time "user is typing..." status
  typingIndicators: defineTable({
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    lastTypingAt: v.number(), // Timestamp of last typing activity
  })
    .index("by_conversation", ["conversationId"])
    .index("by_user_conversation", ["userId", "conversationId"]),

  // ============ AUDIT LOG ============
  auditLogs: defineTable({
    action: v.string(),
    actionType: v.string(),
    resourceType: v.string(),
    resourceId: v.string(),
    userId: v.id("users"),
    userEmail: v.string(),
    details: v.string(),
    timestamp: v.number(),
  })
    .index("by_timestamp", ["timestamp"])
    .index("by_user", ["userId"]),

  // ============ DAILY ACTIVITY LOGS ============
  dailyLogs: defineTable({
    userId: v.id("users"),
    userName: v.string(),
    date: v.string(), // "YYYY-MM-DD" format

    // Manual entry fields
    summary: v.string(), // What you worked on today
    accomplishments: v.array(v.string()), // List of accomplishments
    blockers: v.optional(v.string()), // Any blockers/challenges
    goalsForTomorrow: v.optional(v.string()), // Tomorrow's focus
    hoursWorked: v.optional(v.number()), // Hours worked

    // Auto-captured activity summary (snapshot from audit logs)
    autoActivities: v.optional(
      v.object({
        projectsCreated: v.number(),
        projectsMoved: v.number(),
        tasksCompleted: v.number(),
        totalActions: v.number(),
      })
    ),

    // Linked project IDs (projects worked on)
    projectIds: v.optional(v.array(v.id("projects"))),

    // Reviewer comment (not visible to submitter, shown on reports)
    reviewerComment: v.optional(v.string()),
    reviewerCommentBy: v.optional(v.id("users")),
    reviewerCommentByName: v.optional(v.string()),
    reviewerCommentAt: v.optional(v.number()),

    createdAt: v.number(),
    updatedAt: v.number(),
    isSubmitted: v.boolean(), // Draft vs submitted
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_date", ["date"])
    .index("by_user", ["userId"]),

  // Daily task templates - recurring tasks that reset each day
  dailyTaskTemplates: defineTable({
    userId: v.id("users"), // Who this task is assigned to
    title: v.string(),
    description: v.optional(v.string()),
    isActive: v.boolean(),
    order: v.number(), // Display order
    createdBy: v.id("users"), // Who created it (admin or self)
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_active", ["userId", "isActive"]),

  // Daily task completions - track when tasks are completed
  dailyTaskCompletions: defineTable({
    taskId: v.id("dailyTaskTemplates"),
    userId: v.id("users"),
    date: v.string(), // "YYYY-MM-DD"
    completedAt: v.number(),
  })
    .index("by_user_date", ["userId", "date"])
    .index("by_task_date", ["taskId", "date"]),

  // ============ WEBSITE INQUIRIES (from ietires.com) ============
  contactMessages: defineTable({
    name: v.string(),
    email: v.string(),
    phone: v.optional(v.string()),
    company: v.optional(v.string()),
    subject: v.string(),
    message: v.string(),
    status: v.string(), // "new" | "read" | "replied" | "archived"
    notes: v.optional(v.string()),
    repliedAt: v.optional(v.number()),
    repliedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"]),

  dealerInquiries: defineTable({
    businessName: v.string(),
    contactName: v.string(),
    email: v.string(),
    phone: v.string(),
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    businessType: v.optional(v.string()), // "tire_shop" | "auto_dealer" | "fleet" | "other"
    yearsInBusiness: v.optional(v.number()),
    estimatedMonthlyVolume: v.optional(v.string()),
    currentSuppliers: v.optional(v.string()),
    message: v.optional(v.string()),
    status: v.string(), // "new" | "contacted" | "qualified" | "approved" | "rejected"
    notes: v.optional(v.string()),
    assignedTo: v.optional(v.id("users")),
    followUpDate: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created", ["createdAt"])
    .index("by_assigned", ["assignedTo"]),

  // ============ PERSONNEL MANAGEMENT ============
  // Personnel profiles (hired applicants become personnel)
  personnel: defineTable({
    firstName: v.string(),
    lastName: v.string(),
    email: v.string(),
    phone: v.string(),
    applicationId: v.optional(v.id("applications")), // Link to original application
    position: v.string(), // Job title
    department: v.string(), // "Warehouse", "Sales", "Management", etc.
    locationId: v.optional(v.id("locations")), // Assigned work location
    payrollCompanyId: v.optional(v.id("payrollCompanies")), // For multi-company payroll
    employeeType: v.string(), // "full_time" | "part_time" | "seasonal"
    positionType: v.optional(v.string()), // "hourly" | "salaried" | "management" - Execs/salaried only visible to payroll_manager
    hireDate: v.string(), // YYYY-MM-DD
    hourlyRate: v.optional(v.number()),
    status: v.string(), // "active" | "on_leave" | "terminated"
    terminationDate: v.optional(v.string()),
    terminationReason: v.optional(v.string()),
    emergencyContact: v.optional(v.object({
      name: v.string(),
      phone: v.string(),
      relationship: v.string(),
    })),
    notes: v.optional(v.string()),
    // 90-day employee review — required for benefits & continued employment
    ninetyDayReview: v.optional(v.object({
      completedAt: v.number(),
      completedBy: v.id("users"),
      completedByName: v.string(),
      notes: v.optional(v.string()),
    })),
    // Annual review history — one entry per anniversary cycle.
    // cycleYear is the calendar year of the anniversary the review covers.
    annualReviews: v.optional(v.array(v.object({
      cycleYear: v.number(),
      completedAt: v.number(),
      completedBy: v.id("users"),
      completedByName: v.string(),
      notes: v.optional(v.string()),
    }))),
    completedTraining: v.optional(v.array(v.string())), // Legacy: Array of training area names
    trainingRecords: v.optional(v.array(v.object({
      area: v.string(), // Training area name
      completedAt: v.number(), // Timestamp when training was completed
      certifiedBy: v.optional(v.id("users")), // Who certified the training
    }))),
    // Tenure milestone check-ins (1 day, 3 day, 7 day, 30 day, 60 day)
    tenureCheckIns: v.optional(v.array(v.object({
      milestone: v.string(), // "1_day" | "3_day" | "7_day" | "30_day" | "60_day"
      completedAt: v.number(), // Timestamp when check-in was completed
      completedBy: v.optional(v.id("users")), // Who conducted the check-in (optional for bulk/system operations)
      completedByName: v.string(), // Name of who conducted it (for display)
      notes: v.optional(v.string()), // Any notes from the check-in
    }))),
    // Resume text for AI job matching
    resumeText: v.optional(v.string()),
    resumeUpdatedAt: v.optional(v.number()),
    // AI job match analysis for current employees (what positions they'd be good for)
    jobMatchAnalysis: v.optional(v.object({
      suggestedPositions: v.array(v.object({
        jobId: v.optional(v.id("jobs")),
        jobTitle: v.string(),
        score: v.number(),
        matchedKeywords: v.array(v.string()),
        reasoning: v.string(),
      })),
      extractedSkills: v.array(v.string()),
      summary: v.string(),
      analyzedAt: v.number(),
    })),
    // Schedule assignment - link to default schedule template
    defaultScheduleTemplateId: v.optional(v.id("shiftTemplates")),
    // Schedule preferences for this employee
    schedulePreferences: v.optional(v.object({
      maxHoursPerWeek: v.optional(v.number()), // Maximum hours they want to work
      preferredShifts: v.optional(v.array(v.string())), // "morning" | "afternoon" | "evening" | "night"
      unavailableDays: v.optional(v.array(v.string())), // Days they can't work (e.g., "sunday", "monday")
      notes: v.optional(v.string()), // Additional scheduling notes
    })),
    // Rehire tracking
    originalHireDate: v.optional(v.string()), // Original first hire date (preserved after rehires)
    rehiredAt: v.optional(v.number()), // Timestamp when last rehired
    rehiredBy: v.optional(v.id("users")), // Who authorized the rehire
    employmentHistory: v.optional(v.array(v.object({
      action: v.string(), // "hired" | "terminated" | "rehired"
      date: v.string(),
      reason: v.optional(v.string()),
      position: v.optional(v.string()),
      department: v.optional(v.string()),
      authorizedBy: v.optional(v.string()),
      authorizedById: v.optional(v.id("users")),
    }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_department", ["department"])
    .index("by_status", ["status"])
    .index("by_email", ["email"])
    .index("by_schedule_template", ["defaultScheduleTemplateId"]),

  // Phone call logs for personnel
  personnelCallLogs: defineTable({
    personnelId: v.id("personnel"),
    calledAt: v.number(), // Timestamp of the call
    calledBy: v.id("users"), // Who made the call
    calledByName: v.string(), // Name of caller for display
    duration: v.optional(v.number()), // Call duration in minutes (optional)
    outcome: v.optional(v.string()), // "answered" | "no_answer" | "voicemail" | "busy" | "wrong_number"
    notes: v.optional(v.string()), // Notes about the call
    createdAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_called_at", ["calledAt"])
    .index("by_caller", ["calledBy"]),

  // Write-ups / Disciplinary Records
  writeUps: defineTable({
    personnelId: v.id("personnel"),
    date: v.string(), // YYYY-MM-DD
    category: v.string(), // "attendance" | "behavior" | "safety" | "performance" | "policy_violation"
    severity: v.string(), // "verbal_warning" | "written_warning" | "final_warning" | "suspension"
    description: v.string(),
    actionTaken: v.optional(v.string()),
    followUpRequired: v.boolean(),
    followUpDate: v.optional(v.string()),
    followUpNotes: v.optional(v.string()),
    issuedBy: v.id("users"),
    acknowledgedAt: v.optional(v.number()),
    // Write-ups expire/archive after 90 days from date - not counted for incentives
    isArchived: v.optional(v.boolean()), // Auto-set based on 90-day rule, but can be manually archived
    // Document attachments
    attachments: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      fileName: v.string(),
      fileType: v.string(),
      uploadedAt: v.number(),
    }))),
    createdAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["date"])
    .index("by_severity", ["severity"]),

  // Attendance Records
  attendance: defineTable({
    personnelId: v.id("personnel"),
    date: v.string(), // YYYY-MM-DD
    status: v.string(), // "present" | "on_time" | "grace_period" | "late" | "absent" | "excused" | "no_call_no_show"
    scheduledStart: v.optional(v.string()), // HH:MM
    scheduledEnd: v.optional(v.string()), // HH:MM
    actualStart: v.optional(v.string()), // HH:MM
    actualEnd: v.optional(v.string()), // HH:MM
    hoursWorked: v.optional(v.number()),
    // Tardiness tracking
    minutesLate: v.optional(v.number()), // 0 = on time, positive = late
    wasWithinGrace: v.optional(v.boolean()), // True if was 1-5 min late (grace period)
    // Shift info
    shiftId: v.optional(v.id("shifts")), // If assigned to a specific shift
    timeEntryId: v.optional(v.id("timeEntries")), // Link to clock-in entry
    // Write-up tracking
    linkedWriteUpId: v.optional(v.id("writeUps")), // If converted to write-up
    notes: v.optional(v.string()),
    // Document attachments (doctor's notes, etc.)
    attachments: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      fileName: v.string(),
      fileType: v.string(),
      uploadedAt: v.number(),
    }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["date"])
    .index("by_personnel_date", ["personnelId", "date"])
    .index("by_status", ["status"]),

  // Merits / Commendations
  merits: defineTable({
    personnelId: v.id("personnel"),
    date: v.string(), // YYYY-MM-DD
    type: v.string(), // "performance" | "attendance" | "teamwork" | "safety" | "customer_service" | "initiative"
    title: v.string(),
    description: v.string(),
    issuedBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["date"])
    .index("by_type", ["type"]),

  // Shift Planning (whiteboard style)
  shifts: defineTable({
    date: v.string(), // YYYY-MM-DD
    name: v.optional(v.string()), // Shift name like "Morning", "Evening", etc.
    startTime: v.string(), // HH:MM
    endTime: v.string(), // HH:MM
    position: v.string(), // "Receiving", "Shipping", "Inventory", etc.
    department: v.string(),
    locationId: v.optional(v.id("locations")), // Which location this shift is for
    requiredCount: v.number(), // How many people needed
    assignedPersonnel: v.array(v.id("personnel")),
    leadId: v.optional(v.id("personnel")), // Department lead for this shift
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_department", ["department"])
    .index("by_date_department", ["date", "department"])
    .index("by_location", ["locationId"])
    .index("by_date_location", ["date", "locationId"]),

  // Shift Templates (save full day plans for reuse)
  shiftTemplates: defineTable({
    name: v.string(), // "Monday Standard", "Weekend Skeleton", etc.
    description: v.optional(v.string()),
    locationId: v.optional(v.id("locations")), // Optional location-specific template
    departments: v.array(v.object({
      name: v.string(), // "Shipping", "Receiving", etc.
      position: v.string(),
      startTime: v.string(),
      endTime: v.string(),
      requiredCount: v.number(),
      assignedPersonnel: v.array(v.id("personnel")), // Full personnel saved in template
      leadId: v.optional(v.id("personnel")),
    })),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_location", ["locationId"])
    .index("by_name", ["name"]),

  // Daily Department Tasks (goals/tasks for each day - non-persistent)
  shiftDailyTasks: defineTable({
    date: v.string(), // YYYY-MM-DD
    department: v.string(), // Department name
    locationId: v.optional(v.id("locations")),
    tasks: v.array(v.object({
      id: v.string(), // UUID for each task
      text: v.string(), // The task/goal text
      completed: v.optional(v.boolean()), // Optional completion tracking
    })),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_date_department", ["date", "department"]),

  // Schedule Overrides - One-off changes to an employee's regular schedule
  scheduleOverrides: defineTable({
    personnelId: v.id("personnel"),
    date: v.string(), // YYYY-MM-DD - the date this override applies to
    overrideType: v.string(), // "day_off" | "modified_hours" | "extra_shift" | "swap"
    // For modified_hours or extra_shift:
    startTime: v.optional(v.string()), // HH:MM
    endTime: v.optional(v.string()), // HH:MM
    // For swaps:
    swapWithPersonnelId: v.optional(v.id("personnel")),
    originalShiftId: v.optional(v.id("shifts")), // The shift being swapped from
    // Status
    status: v.string(), // "pending" | "approved" | "denied"
    reason: v.optional(v.string()), // Why the override is needed
    // Approval
    requestedBy: v.optional(v.id("users")), // If requested by someone other than admin
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    denialReason: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["date"])
    .index("by_personnel_date", ["personnelId", "date"])
    .index("by_status", ["status"]),

  // Performance Reviews
  performanceReviews: defineTable({
    personnelId: v.id("personnel"),
    reviewPeriod: v.string(), // "Q1 2025", "Annual 2024", etc.
    reviewDate: v.string(), // YYYY-MM-DD
    reviewedBy: v.id("users"),
    overallRating: v.number(), // 1-5 scale
    categories: v.array(v.object({
      name: v.string(), // "Attendance", "Quality of Work", "Teamwork", etc.
      rating: v.number(), // 1-5
      notes: v.optional(v.string()),
    })),
    strengths: v.array(v.string()),
    areasForImprovement: v.array(v.string()),
    goals: v.array(v.object({
      goal: v.string(),
      targetDate: v.optional(v.string()),
      completed: v.boolean(),
    })),
    employeeComments: v.optional(v.string()),
    managerNotes: v.optional(v.string()),
    acknowledgedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["reviewDate"]),

  // Employee performance reviews (90-day + annual). Travis rates 1-5 on paper;
  // scores entered here compute an average + recommended raise tier; Andy marks
  // approved/denied + the approved increase. Questions/tiers in lib/reviewQuestions.ts.
  employeeReviews: defineTable({
    personnelId: v.id("personnel"),
    reviewType: v.string(),                 // "90_day" | "annual"
    employeeName: v.string(),               // snapshot at generation (preprinted on form)
    position: v.optional(v.string()),
    department: v.optional(v.string()),
    hireDate: v.optional(v.string()),
    reviewPeriodLabel: v.string(),          // "90-Day Review" | "Annual Review 2026"
    reviewerName: v.optional(v.string()),   // who completed the paper form (e.g. Travis)
    ratings: v.array(v.object({
      questionId: v.string(),
      section: v.string(),
      rating: v.number(),                   // 1-5 (0 = unrated)
    })),
    averageScore: v.optional(v.number()),
    recommendedIncrease: v.optional(v.string()),
    generalComments: v.optional(v.string()),
    decision: v.string(),                   // "pending" | "approved" | "denied"
    approvedIncrease: v.optional(v.string()), // what Andy/Terry approved (free text, e.g. "2.5%")
    decidedByName: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    status: v.string(),                     // "generated" | "scored" | "decided"
    createdByName: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_type_status", ["reviewType", "status"])
    .index("by_status", ["status"]),

  // ============ NOTIFICATIONS ============
  notifications: defineTable({
    userId: v.id("users"), // Who should receive the notification
    type: v.string(), // "tenure_check_in" | "write_up_follow_up" | "review_due" | etc.
    title: v.string(),
    message: v.string(),
    link: v.optional(v.string()), // URL to navigate to when clicked
    relatedPersonnelId: v.optional(v.id("personnel")),
    relatedId: v.optional(v.string()), // Generic related ID (write-up, review, etc.)
    isRead: v.boolean(),
    isDismissed: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_unread", ["userId", "isRead"])
    .index("by_type", ["type"]),

  // ============ PROJECT SUGGESTIONS ============
  projectSuggestions: defineTable({
    suggestedBy: v.id("users"),
    suggestedTo: v.id("users"),
    title: v.string(),
    description: v.string(),
    priority: v.optional(v.string()), // "low" | "medium" | "high" | "urgent"
    status: v.string(), // "pending" | "approved" | "denied"
    // Approval fields
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    denialReason: v.optional(v.string()),
    estimatedTimeline: v.optional(v.string()), // e.g., "2 weeks", "1 month", etc.
    // If approved, link to created project
    projectId: v.optional(v.id("projects")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_suggested_to", ["suggestedTo"])
    .index("by_suggested_by", ["suggestedBy"])
    .index("by_status", ["status"]),

  // ============ LOCATIONS ============
  locations: defineTable({
    name: v.string(), // e.g., "Main Warehouse", "Distribution Center 2"
    locationType: v.optional(v.string()), // "warehouse" | "retail" | "office" | "distribution"
    address: v.optional(v.string()),
    city: v.optional(v.string()),
    state: v.optional(v.string()),
    zipCode: v.optional(v.string()),
    phone: v.optional(v.string()), // Location phone number
    // Security codes
    pinCode: v.optional(v.string()), // Door PIN/code lock
    alarmCode: v.optional(v.string()), // Alarm system code
    gateCode: v.optional(v.string()), // Gate access code
    wifiPassword: v.optional(v.string()), // WiFi password
    securityNotes: v.optional(v.string()), // Additional security notes
    isActive: v.boolean(),
    managerId: v.optional(v.id("users")), // Manager responsible for this location
    // Departments available at this location
    departments: v.optional(v.array(v.string())), // e.g., ["Retail", "Retail Management"] or ["Shipping", "Receiving"]
    // Warehouse manager contact info (displayed on shift prints)
    warehouseManagerName: v.optional(v.string()),
    warehouseManagerPhone: v.optional(v.string()),
    warehouseManagerEmail: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_name", ["name"])
    .index("by_active", ["isActive"])
    .index("by_manager", ["managerId"])
    .index("by_type", ["locationType"]),

  // ============ EQUIPMENT INVENTORY ============
  // Scanners (RF scanners, barcode scanners, etc.)
  scanners: defineTable({
    number: v.string(), // Scanner identifier (e.g., "W08-001", "R10-042")
    pin: v.optional(v.string()),
    deviceOwner: v.optional(v.boolean()),
    pinManaged: v.optional(v.boolean()),
    serialNumber: v.optional(v.string()),
    model: v.optional(v.string()), // e.g., "Zebra TC51", "Zebra MC3300"
    locationId: v.id("locations"),
    status: v.string(), // "available" | "assigned" | "maintenance" | "lost" | "retired"
    assignedTo: v.optional(v.id("personnel")),
    assignedAt: v.optional(v.number()),
    lastMaintenanceDate: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    retiredAt: v.optional(v.number()),
    retiredReason: v.optional(v.string()),
    // IoT Core MDM fields
    iotThingName: v.optional(v.string()), // AWS IoT thing name (e.g., "scanner-W08-001")
    iotThingArn: v.optional(v.string()),
    iotCertificateArn: v.optional(v.string()),
    provisionedAt: v.optional(v.number()),
    mdmStatus: v.optional(v.string()), // "provisioned" | "pending" | "deprovisioned"
    // Live telemetry (updated by scanner-status Lambda)
    isOnline: v.optional(v.boolean()),
    lastSeen: v.optional(v.number()),
    batteryLevel: v.optional(v.number()), // 0-100
    wifiSignal: v.optional(v.number()), // dBm
    gpsLatitude: v.optional(v.number()),
    gpsLongitude: v.optional(v.number()),
    installedApps: v.optional(v.object({
      tireTrack: v.optional(v.string()),
      rtLocator: v.optional(v.string()),
      scannerAgent: v.optional(v.string()),
    })),
    agentVersion: v.optional(v.string()),
    androidVersion: v.optional(v.string()),
    // Storage telemetry
    storageTotal: v.optional(v.number()), // Total internal storage in MB
    storageFree: v.optional(v.number()), // Free internal storage in MB
    // MDM state
    isLocked: v.optional(v.boolean()),
    lastCommandId: v.optional(v.string()),
    lastCommandStatus: v.optional(v.string()), // "pending" | "acknowledged" | "completed" | "failed"
    // Alerts
    scannerAlerts: v.optional(v.array(v.object({
      type: v.string(), // "low_battery" | "offline" | "low_storage"
      message: v.string(),
      createdAt: v.number(),
      resolved: v.boolean(),
    }))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_location", ["locationId"])
    .index("by_number", ["number"])
    .index("by_status", ["status"])
    .index("by_assigned", ["assignedTo"])
    .index("by_iot_thing", ["iotThingName"])
    .index("by_serial", ["serialNumber"])
    .index("by_online", ["isOnline"]),

  // Deduped per-(program, dealer, activity-month) net tires — source of truth for rebate stats.
  // Rebuilt from all of a month's S3 OEA07V files by /api/dealer-rebates/rebuild-month.
  dealerRebateMonthly: defineTable({
    month: v.string(),        // "YYYY-MM"
    program: v.string(),      // "falken" | "milestar"
    jmk: v.string(),
    name: v.string(),
    fanaticId: v.optional(v.number()),
    dealerNumber: v.optional(v.string()),
    qty: v.number(),          // NET tires
    rowCount: v.number(),
    updatedAt: v.number(),
  })
    .index("by_month", ["month"])
    .index("by_month_program", ["month", "program"]),

  // Global scanner lock-down policy (single row). Drives the allowlist lockdown
  // + DataWedge/screen settings applied during scanner setup.
  scannerLockPolicy: defineTable({
    allowedPackages: v.array(v.string()), // extra packages to KEEP enabled (beyond essentials + IET apps)
    lockdownEnabled: v.boolean(),
    dataWedgeTab: v.boolean(),
    screenTimeoutMs: v.optional(v.number()),
    screenRotation: v.optional(v.string()), // "portrait" | "landscape"
    updatedAt: v.number(),
    updatedBy: v.optional(v.id("users")),
  }),

  // Pickers (order picking devices/equipment)
  pickers: defineTable({
    number: v.string(), // Picker identifier (e.g., "1", "P-01", "PK-A")
    pin: v.optional(v.string()), // PIN code for the picker
    serialNumber: v.optional(v.string()),
    model: v.optional(v.string()),
    locationId: v.id("locations"),
    status: v.string(), // "available" | "assigned" | "maintenance" | "lost" | "retired"
    assignedTo: v.optional(v.id("personnel")),
    assignedAt: v.optional(v.number()),
    lastMaintenanceDate: v.optional(v.string()),
    purchaseDate: v.optional(v.string()),
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()), // Current condition of the equipment
    retiredAt: v.optional(v.number()), // When the equipment was retired
    retiredReason: v.optional(v.string()), // Why it was retired
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_location", ["locationId"])
    .index("by_number", ["number"])
    .index("by_status", ["status"])
    .index("by_assigned", ["assignedTo"]),

  // Equipment agreements (signed disclosures for assigned equipment)
  equipmentAgreements: defineTable({
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    personnelId: v.id("personnel"),
    equipmentNumber: v.string(), // Equipment identifier at time of signing
    serialNumber: v.optional(v.string()), // Serial number at time of signing
    equipmentValue: v.number(), // Dollar value (e.g., 100)
    agreementText: v.string(), // Full disclosure text
    signatureData: v.string(), // Base64 encoded signature image
    signedAt: v.number(), // Timestamp when signed
    witnessedBy: v.id("users"), // Admin/manager who processed assignment
    witnessedByName: v.string(), // Name for display
    // Revocation (when equipment is unassigned)
    revokedAt: v.optional(v.number()),
    revokedBy: v.optional(v.id("users")),
    revokedReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_equipment", ["equipmentType", "equipmentId"])
    .index("by_personnel", ["personnelId"])
    .index("by_signed", ["signedAt"]),

  // Equipment return condition checks (manager validates before reassignment)
  equipmentConditionChecks: defineTable({
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    returnedBy: v.id("personnel"), // Who returned the equipment
    checkedBy: v.id("users"), // Manager who performed the check
    checkedByName: v.string(),
    // Checklist items
    checklist: v.object({
      physicalCondition: v.boolean(), // No visible damage
      screenFunctional: v.boolean(), // Screen works (for scanners)
      buttonsWorking: v.boolean(), // All buttons responsive
      batteryCondition: v.boolean(), // Battery holds charge
      chargingPortOk: v.boolean(), // Charging port not damaged
      scannerFunctional: v.boolean(), // Barcode scanning works
      cleanCondition: v.boolean(), // Equipment is clean
    }),
    overallCondition: v.string(), // "excellent" | "good" | "fair" | "poor" | "damaged"
    damageNotes: v.optional(v.string()), // Details of any damage found
    repairRequired: v.boolean(),
    readyForReassignment: v.boolean(), // Manager confirms ready to assign to next person
    deductionRequired: v.optional(v.boolean()), // If damage requires pay deduction
    deductionAmount: v.optional(v.number()), // Amount to deduct
    // Manager sign-off signature
    signOffSignature: v.optional(v.string()), // Base64 encoded signature image
    signOffAt: v.optional(v.number()), // When manager signed off
    // Context for this check
    checkType: v.optional(v.string()), // "return" | "reassign" - optional for backward compatibility
    reassignedTo: v.optional(v.id("personnel")), // If this was part of a reassignment
    checkedAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_equipment", ["equipmentType", "equipmentId"])
    .index("by_personnel", ["returnedBy"])
    .index("by_checked", ["checkedAt"]),

  // ============ SCANNER MDM ============
  // Per-location scanner setup configuration
  scannerMdmConfigs: defineTable({
    locationId: v.id("locations"),
    locationCode: v.string(), // "W08", "R10", "W09"
    rtLocatorUrl: v.string(),
    defaultDeviceIdPrefix: v.string(), // e.g., "W08-"
    screenTimeoutMs: v.number(), // Default 1800000 (30 min)
    screenRotation: v.string(), // "auto" | "portrait" | "landscape"
    bloatwarePackages: v.array(v.string()), // Package names to disable
    wifiSsid: v.optional(v.string()),
    wifiPassword: v.optional(v.string()),
    tireTrackApkSource: v.string(), // "expo" | "s3"
    tireTrackApkS3Key: v.optional(v.string()),
    rtLocatorApkS3Key: v.optional(v.string()),
    agentApkS3Key: v.optional(v.string()),
    currentTireTrackVersion: v.optional(v.string()),
    currentRtLocatorVersion: v.optional(v.string()),
    currentAgentVersion: v.optional(v.string()),
    rtConfigXml: v.optional(v.string()), // RT config XML template
    notes: v.optional(v.string()),
    updatedBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_location", ["locationId"])
    .index("by_code", ["locationCode"]),

  // Remote command audit log
  scannerCommandLog: defineTable({
    scannerId: v.id("scanners"),
    scannerNumber: v.string(), // Denormalized for display
    command: v.string(), // "lock" | "unlock" | "wipe" | "install_apk" | "push_config" | "restart" | "update_pin"
    payload: v.optional(v.string()), // JSON payload sent with command
    status: v.string(), // "sent" | "acknowledged" | "completed" | "failed" | "timeout"
    issuedBy: v.id("users"),
    issuedByName: v.string(), // Denormalized
    issuedAt: v.number(),
    acknowledgedAt: v.optional(v.number()),
    completedAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
  })
    .index("by_scanner", ["scannerId"])
    .index("by_status", ["status"])
    .index("by_issued", ["issuedAt"]),

  // Scanner provision codes — temporary claim codes for web-based provisioning
  scannerProvisionCodes: defineTable({
    code: v.string(), // 6-char uppercase alphanumeric claim code
    scannerId: v.id("scanners"),
    thingName: v.string(),
    thingArn: v.string(),
    certificateArn: v.string(),
    certificatePem: v.optional(v.string()), // Nulled after expiry/cleanup
    privateKey: v.optional(v.string()), // Nulled after expiry/cleanup
    iotEndpoint: v.string(),
    expiresAt: v.number(), // Unix timestamp, 15 min from creation
    claimed: v.boolean(),
    claimedAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_scanner", ["scannerId"]),

  // Scanner setup logs — track step-by-step progress during device setup
  scannerSetupLogs: defineTable({
    scannerId: v.id("scanners"),
    step: v.string(), // "detect" | "location" | "generate" | "installRtl" | "installTireTrack" | "installAgent" | "pushRtConfig" | "grantPerms" | "settings" | "deviceAdmin" | "bloatware" | "launchSetupActivity" | "verify" | "done"
    status: v.string(), // "started" | "success" | "skipped" | "failed"
    durationMs: v.optional(v.number()),
    error: v.optional(v.string()),
    browserAgent: v.optional(v.string()),
    actingUserId: v.optional(v.id("users")),
    createdAt: v.number(),
  })
    .index("by_scanner", ["scannerId"])
    .index("by_scanner_created", ["scannerId", "createdAt"]),

  // Vehicles (company fleet)
  vehicles: defineTable({
    // Identification
    vin: v.string(), // Vehicle Identification Number (17 characters)
    plateNumber: v.optional(v.string()), // License plate
    // Vehicle details
    year: v.optional(v.number()), // Model year (e.g., 2024)
    make: v.string(), // Ford, Chevrolet, Toyota, etc.
    model: v.string(), // F-150, Silverado, Camry, etc.
    trim: v.optional(v.string()), // XLT, LT, LE, etc.
    color: v.optional(v.string()),
    fuelType: v.optional(v.string()), // "gasoline" | "diesel" | "electric" | "hybrid"
    // Location & Assignment
    locationId: v.optional(v.id("locations")),
    assignedTo: v.optional(v.id("personnel")), // Current driver
    assignedAt: v.optional(v.number()),
    // Status
    status: v.string(), // "active" | "maintenance" | "out_of_service" | "retired"
    // Mileage tracking
    currentMileage: v.optional(v.number()), // Current odometer reading
    lastMileageUpdate: v.optional(v.number()), // When mileage was last updated
    // Insurance
    insurancePolicyNumber: v.optional(v.string()),
    insuranceProvider: v.optional(v.string()),
    insuranceExpirationDate: v.optional(v.string()), // YYYY-MM-DD
    // Registration
    registrationExpirationDate: v.optional(v.string()), // YYYY-MM-DD
    registrationState: v.optional(v.string()), // PA, OH, etc.
    // Purchase info
    purchaseDate: v.optional(v.string()), // YYYY-MM-DD
    purchasePrice: v.optional(v.number()),
    purchasedFrom: v.optional(v.string()), // Dealer name
    // Maintenance
    lastMaintenanceDate: v.optional(v.string()),
    nextMaintenanceDue: v.optional(v.string()), // Date or mileage
    nextMaintenanceMileage: v.optional(v.number()),
    // Notes
    notes: v.optional(v.string()),
    conditionNotes: v.optional(v.string()),
    // Retirement
    retiredAt: v.optional(v.number()),
    retiredReason: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_vin", ["vin"])
    .index("by_plate", ["plateNumber"])
    .index("by_status", ["status"])
    .index("by_location", ["locationId"])
    .index("by_assigned", ["assignedTo"]),

  // Equipment assignment history (for audit trail)
  equipmentHistory: defineTable({
    equipmentType: v.string(), // "scanner" | "picker"
    equipmentId: v.union(v.id("scanners"), v.id("pickers")),
    action: v.string(), // "assigned" | "unassigned" | "maintenance" | "status_change" | "condition_check"
    previousStatus: v.optional(v.string()),
    newStatus: v.optional(v.string()),
    previousAssignee: v.optional(v.id("personnel")),
    newAssignee: v.optional(v.id("personnel")),
    conditionCheckId: v.optional(v.id("equipmentConditionChecks")), // Link to condition check if applicable
    performedBy: v.id("users"),
    notes: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_equipment", ["equipmentType", "equipmentId"])
    .index("by_created", ["createdAt"]),

  // ============ SAFETY CHECKLISTS ============
  // Safety checklist templates (admin-editable)
  safetyChecklistTemplates: defineTable({
    name: v.string(), // "Standard Picker Checklist"
    isDefault: v.boolean(), // True for the standard template
    equipmentType: v.string(), // "picker" | "scanner" | "all"
    items: v.array(v.object({
      id: v.string(), // Unique ID for the item
      question: v.string(), // "Check hydraulic fluid levels"
      description: v.optional(v.string()), // Detailed instructions
      minimumSeconds: v.number(), // Minimum time before can proceed (e.g., 30)
      order: v.number(), // Display order
      // Damage reporting fields
      responseType: v.optional(v.string()), // "yes_no" | "yes_no_na" | "condition_report" - defaults to "yes_no"
      requiresDetailsOn: v.optional(v.string()), // "yes" | "no" | "na" | "always" | "never" - when to require details
      detailsPrompt: v.optional(v.string()), // Custom prompt for details (e.g., "Describe the damage observed")
      expectedAnswer: v.optional(v.string()), // "yes" | "no" - the expected passing answer (defaults to "yes")
    })),
    createdAt: v.number(),
    updatedAt: v.number(),
    createdBy: v.id("users"),
  })
    .index("by_default", ["isDefault"])
    .index("by_equipment_type", ["equipmentType"]),

  // Equipment-specific checklist configuration (overrides/additions)
  equipmentChecklistConfig: defineTable({
    equipmentType: v.string(), // "picker" or "scanner"
    equipmentId: v.union(v.id("pickers"), v.id("scanners")), // Specific equipment
    templateId: v.optional(v.id("safetyChecklistTemplates")), // Override default template
    additionalItems: v.optional(v.array(v.object({
      id: v.string(),
      question: v.string(),
      description: v.optional(v.string()),
      minimumSeconds: v.number(),
      order: v.number(),
      // Damage reporting fields
      responseType: v.optional(v.string()), // "yes_no" | "yes_no_na" | "condition_report"
      requiresDetailsOn: v.optional(v.string()), // "yes" | "no" | "na" | "always" | "never"
      detailsPrompt: v.optional(v.string()),
      expectedAnswer: v.optional(v.string()), // "yes" | "no" - the expected passing answer (defaults to "yes")
    }))), // Extra questions for this specific equipment
    personnelOverrides: v.optional(v.array(v.object({
      personnelId: v.id("personnel"),
      additionalItems: v.array(v.object({
        id: v.string(),
        question: v.string(),
        minimumSeconds: v.number(),
        responseType: v.optional(v.string()),
        requiresDetailsOn: v.optional(v.string()),
        detailsPrompt: v.optional(v.string()),
        expectedAnswer: v.optional(v.string()), // "yes" | "no" - the expected passing answer (defaults to "yes")
      })),
    }))), // Extra questions for specific people on this equipment
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_equipment", ["equipmentType", "equipmentId"]),

  // Completed safety checklist records
  safetyChecklistCompletions: defineTable({
    equipmentType: v.string(), // "picker" | "scanner"
    equipmentId: v.union(v.id("pickers"), v.id("scanners")),
    equipmentNumber: v.string(), // Equipment number at time of completion (for display)
    personnelId: v.id("personnel"),
    personnelName: v.string(), // Name at time of completion (for display)
    templateId: v.optional(v.id("safetyChecklistTemplates")),
    responses: v.array(v.object({
      itemId: v.string(),
      question: v.string(),
      passed: v.boolean(),
      response: v.optional(v.string()), // "yes" | "no" | "na" - the actual response given
      notes: v.optional(v.string()),
      damageReported: v.optional(v.boolean()), // True if damage was reported for this item
      damageDetails: v.optional(v.string()), // Description of damage if reported
      timeSpent: v.number(), // Actual seconds spent on this item
      completedAt: v.number(),
    })),
    allPassed: v.boolean(),
    totalTimeSpent: v.number(), // Total seconds
    issues: v.optional(v.array(v.object({
      itemId: v.string(),
      description: v.string(),
    }))),
    shiftDate: v.string(), // "2024-12-30" for easy querying
    locationId: v.optional(v.id("locations")),
    completedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_personnel_date", ["personnelId", "shiftDate"])
    .index("by_equipment", ["equipmentType", "equipmentId"])
    .index("by_equipment_date", ["equipmentType", "equipmentId", "shiftDate"])
    .index("by_date", ["shiftDate"]),

  // ============ DOCUMENT HUB ============
  // Frequently used documents (forms, templates, etc.)
  documents: defineTable({
    name: v.string(), // Document name/title
    description: v.optional(v.string()), // Brief description
    category: v.string(), // "forms" | "policies" | "sops" | "templates" | "training" | "other"
    folderId: v.optional(v.id("documentFolders")), // Optional folder for organization
    fileId: v.id("_storage"), // Convex storage ID for the file
    fileName: v.string(), // Original filename
    fileType: v.string(), // MIME type (application/pdf, etc.)
    fileSize: v.number(), // File size in bytes
    uploadedBy: v.id("users"),
    uploadedByName: v.string(), // For display purposes
    isActive: v.boolean(),
    downloadCount: v.number(), // Track usage
    // Visibility: "private" (owner only), "internal" (all employees), "community" (public/shared)
    visibility: v.optional(v.string()), // Defaults to "private" if not set
    // Shared with specific users and groups
    sharedWith: v.optional(v.array(v.id("users"))),
    sharedWithGroups: v.optional(v.array(v.id("groups"))),
    // Public access settings
    isPublic: v.optional(v.boolean()), // Whether document is publicly accessible
    publicSlug: v.optional(v.string()), // URL-friendly slug for public access
    expiresAt: v.optional(v.number()), // Unix timestamp for document expiration
    expirationAlertDays: v.optional(v.number()), // Days before expiration to alert (default 30)
    // E-Signature settings
    requiresSignature: v.optional(v.boolean()), // Whether this document requires e-signatures
    signatureCount: v.optional(v.number()), // Number of signatures collected
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_active", ["isActive"])
    .index("by_created", ["createdAt"])
    .index("by_public_slug", ["publicSlug"])
    .index("by_folder", ["folderId"])
    .index("by_owner", ["uploadedBy"])
    .index("by_visibility", ["visibility"]),

  // ============ DOCUMENT HUB E-SIGNATURES ============
  docHubSignatures: defineTable({
    documentId: v.id("documents"),
    signedBy: v.id("users"),
    signedByName: v.string(),
    signedByEmail: v.optional(v.string()),
    signatureData: v.string(), // Base64 signature image from canvas
    signedAt: v.number(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"])
    .index("by_user", ["signedBy"]),

  // ============ DOCUMENT FOLDERS ============
  documentFolders: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    passwordHash: v.optional(v.string()), // Optional - null = unprotected, set = protected
    parentFolderId: v.optional(v.id("documentFolders")), // For nested folders
    // HIPAA-compliant visibility levels:
    // "private" - Only owner can see (default for password-protected)
    // "community" - All users can see (for policies, handbooks, etc.)
    visibility: v.optional(v.string()), // "private" | "internal" | "community" - defaults to "private"
    sharedWithGroups: v.optional(v.array(v.id("groups"))), // Groups that can access this folder
    createdBy: v.id("users"),
    createdByName: v.string(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_created", ["createdAt"])
    .index("by_parent", ["parentFolderId"])
    .index("by_visibility", ["visibility"])
    .index("by_owner", ["createdBy"]),

  // Folder access grants (sharing protected folders)
  folderAccessGrants: defineTable({
    folderId: v.id("documentFolders"),
    grantedToUserId: v.id("users"),
    grantedToUserName: v.string(),
    grantedByUserId: v.id("users"),
    grantedByUserName: v.string(),
    grantedAt: v.number(),
    expiresAt: v.optional(v.number()), // Optional expiration
    isRevoked: v.boolean(),
    revokedAt: v.optional(v.number()),
    revokedByUserId: v.optional(v.id("users")),
  })
    .index("by_folder", ["folderId"])
    .index("by_user", ["grantedToUserId"])
    .index("by_folder_user", ["folderId", "grantedToUserId"]),

  // HIPAA-compliant folder access audit log
  folderAccessLog: defineTable({
    folderId: v.id("documentFolders"),
    folderName: v.string(),
    userId: v.id("users"),
    userName: v.string(),
    userEmail: v.optional(v.string()),
    action: v.string(), // "view" | "download" | "upload" | "share" | "password_attempt"
    accessMethod: v.string(), // "password" | "grant" | "owner" | "community"
    success: v.boolean(),
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),
    timestamp: v.number(),
  })
    .index("by_folder", ["folderId"])
    .index("by_user", ["userId"])
    .index("by_timestamp", ["timestamp"]),

  // User's custom folder ordering preferences (per section)
  userFolderOrder: defineTable({
    userId: v.id("users"),
    section: v.string(), // "myFolders" | "shared" | "community"
    folderIds: v.array(v.id("documentFolders")), // Ordered array of folder IDs
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_section", ["userId", "section"]),

  // ============ CUSTOM GROUPS (for Doc Hub sharing) ============
  groups: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    color: v.optional(v.string()), // Hex color for display
    memberIds: v.array(v.id("users")),
    createdBy: v.id("users"),
    createdByName: v.string(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_created", ["createdAt"]),

  // ============ BROADCAST MESSAGES ============
  // System-wide announcements from super users
  broadcastMessages: defineTable({
    title: v.string(),
    content: v.string(),
    type: v.string(), // "info" | "warning" | "success" | "update"
    priority: v.string(), // "normal" | "high"
    isActive: v.boolean(),
    startsAt: v.optional(v.number()), // When to start showing (null = immediately)
    expiresAt: v.optional(v.number()), // When to auto-hide (null = manual only)
    targetRoles: v.optional(v.array(v.string())), // Which roles see this (null = all)
    dismissedBy: v.array(v.id("users")), // Users who have dismissed this message
    createdBy: v.id("users"),
    createdByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_created", ["createdAt"]),

  // ============ USER DASHBOARD SETTINGS ============
  // Per-user dashboard customization (which cards to show)
  userDashboardSettings: defineTable({
    userId: v.id("users"),
    // Available cards: "projects" | "applications" | "websiteMessages" | "hiringAnalytics" | "activityFeed" | "tenureCheckIns"
    enabledCards: v.array(v.string()), // Which cards are enabled
    cardOrder: v.optional(v.array(v.string())), // Optional custom ordering
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"]),

  // ============ HOLIDAYS & SCHEDULE OVERRIDES ============
  // Global holidays and schedule overrides (prevents NCNS triggers)
  holidays: defineTable({
    name: v.string(), // e.g., "Christmas Day", "Thanksgiving"
    date: v.string(), // YYYY-MM-DD format
    type: v.string(), // "holiday" | "closure" | "override"
    isPaidHoliday: v.boolean(), // Whether employees are paid for this day
    affectedLocations: v.optional(v.array(v.id("locations"))), // Empty = all locations
    affectedDepartments: v.optional(v.array(v.string())), // Empty = all departments
    isRecurring: v.optional(v.boolean()), // Repeats every year
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_type", ["type"]),

  // ============ DELETED RECORDS (SOFT DELETE) ============
  // Archive of deleted records for admin deletion with super_admin restore
  deletedRecords: defineTable({
    tableName: v.string(), // Original table: "personnel", "users", "jobs", etc.
    originalId: v.string(), // The original _id of the deleted record
    recordData: v.string(), // JSON stringified original record data
    recordSummary: v.string(), // Human-readable summary (e.g., "John Doe - Employee")
    deletedBy: v.id("users"),
    deletedByName: v.string(), // Cached for display
    deletedAt: v.number(),
    reason: v.optional(v.string()), // Optional deletion reason
    restoredAt: v.optional(v.number()), // If restored
    restoredBy: v.optional(v.id("users")), // Who restored it
  })
    .index("by_table", ["tableName"])
    .index("by_deleted_at", ["deletedAt"])
    .index("by_deleted_by", ["deletedBy"]),

  // ============ TIME CLOCK ============
  // Raw time entries (clock in/out, breaks)
  timeEntries: defineTable({
    personnelId: v.id("personnel"),
    date: v.string(), // YYYY-MM-DD
    type: v.string(), // "clock_in" | "clock_out" | "break_start" | "break_end"
    timestamp: v.number(), // Unix timestamp (ms)
    source: v.string(), // "admin" | "mobile" | "kiosk"
    locationId: v.optional(v.id("locations")),
    gpsCoordinates: v.optional(v.object({
      lat: v.number(),
      lng: v.number(),
    })),
    notes: v.optional(v.string()),
    // Late tracking (for clock_in entries)
    scheduledStart: v.optional(v.string()), // HH:MM scheduled start time
    minutesLate: v.optional(v.number()), // Minutes late (if any)
    isLate: v.optional(v.boolean()), // True if more than 5 min grace period
    // Edit tracking
    editedBy: v.optional(v.id("users")), // If manually adjusted
    editedAt: v.optional(v.number()),
    originalTimestamp: v.optional(v.number()), // Value before edit
    editReason: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["date"])
    .index("by_personnel_date", ["personnelId", "date"]),

  // Time correction requests (employee requests, manager approval)
  timeCorrections: defineTable({
    personnelId: v.id("personnel"),
    timeEntryId: v.optional(v.id("timeEntries")), // If editing existing entry
    date: v.string(), // YYYY-MM-DD
    requestType: v.string(), // "edit" | "add_missed" | "delete"
    // For edits
    currentTimestamp: v.optional(v.number()), // Current value
    requestedTimestamp: v.optional(v.number()), // Requested new value
    // For adding missed entries
    requestedType: v.optional(v.string()), // "clock_in" | "clock_out" | "break_start" | "break_end"
    reason: v.string(),
    status: v.string(), // "pending" | "approved" | "denied"
    requestedAt: v.number(),
    // Review fields
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    reviewNotes: v.optional(v.string()),
  })
    .index("by_status", ["status"])
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["date"]),

  // ============ EMPLOYEE PORTAL ============

  // Overtime Offers (optional Saturday overtime)
  overtimeOffers: defineTable({
    date: v.string(), // YYYY-MM-DD - the Saturday being offered
    title: v.string(), // e.g., "Saturday Overtime - January 18th"
    description: v.optional(v.string()), // Additional details
    startTime: v.string(), // HH:MM
    endTime: v.string(), // HH:MM
    locationId: v.optional(v.id("locations")),
    department: v.optional(v.string()), // Target department (or all)
    maxSlots: v.optional(v.number()), // Max number of employees needed (null = unlimited)
    payRate: v.optional(v.string()), // e.g., "1.5x", "2x", "Regular + $5/hr"
    // Targeting
    targetType: v.string(), // "all" | "department" | "location" | "specific"
    targetPersonnelIds: v.optional(v.array(v.id("personnel"))), // If specific employees
    // Status
    status: v.string(), // "open" | "closed" | "cancelled"
    // Notification tracking
    notificationSentAt: v.optional(v.number()),
    // Created by
    createdBy: v.id("users"),
    createdByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_status", ["status"])
    .index("by_location", ["locationId"]),

  // Overtime Responses (employee accepts/declines)
  overtimeResponses: defineTable({
    offerId: v.id("overtimeOffers"),
    personnelId: v.id("personnel"),
    response: v.string(), // "accepted" | "declined" | "pending"
    respondedAt: v.optional(v.number()),
    notes: v.optional(v.string()), // Employee can add a note
    // Notification tracking
    notifiedAt: v.optional(v.number()), // When push notification was sent
    reminderSentAt: v.optional(v.number()), // If reminder was sent
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_offer", ["offerId"])
    .index("by_personnel", ["personnelId"])
    .index("by_offer_personnel", ["offerId", "personnelId"])
    .index("by_response", ["response"]),

  // Time Off Requests
  timeOffRequests: defineTable({
    personnelId: v.id("personnel"),
    requestType: v.string(), // "vacation" | "sick" | "personal" | "bereavement" | "other"
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(), // YYYY-MM-DD
    totalDays: v.number(), // Calculated days requested
    reason: v.optional(v.string()),
    status: v.string(), // "pending" | "approved" | "denied"
    requestedAt: v.number(),
    // Review fields
    reviewedBy: v.optional(v.id("users")),
    reviewedAt: v.optional(v.number()),
    managerNotes: v.optional(v.string()),
    // Notification tracking
    managerNotifiedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_status", ["status"])
    .index("by_date", ["startDate"])
    .index("by_requested", ["requestedAt"]),

  // Call-Offs (same-day absences)
  callOffs: defineTable({
    personnelId: v.id("personnel"),
    date: v.string(), // YYYY-MM-DD
    reason: v.string(),
    reportedAt: v.number(), // When they called off
    reportedVia: v.string(), // "app" | "phone" | "text" | "other"
    // Acknowledgment by manager
    acknowledgedBy: v.optional(v.id("users")),
    acknowledgedAt: v.optional(v.number()),
    managerNotes: v.optional(v.string()),
    // Notification tracking
    managerNotifiedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_date", ["date"])
    .index("by_reported", ["reportedAt"]),

  // Announcements (admin broadcasts to employees)
  announcements: defineTable({
    title: v.string(),
    content: v.string(),
    priority: v.string(), // "normal" | "urgent"
    targetType: v.string(), // "all" | "department" | "location"
    targetDepartments: v.optional(v.array(v.string())), // If targeting specific departments
    targetLocationIds: v.optional(v.array(v.id("locations"))), // If targeting specific locations
    createdBy: v.id("users"),
    createdByName: v.string(),
    expiresAt: v.optional(v.number()), // Auto-hide after this time
    isPinned: v.boolean(), // Keep at top
    isActive: v.boolean(),
    // Push notification tracking
    pushSent: v.boolean(),
    pushSentAt: v.optional(v.number()),
    // Read tracking (optional, for analytics)
    readCount: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_priority", ["priority"])
    .index("by_created", ["createdAt"]),

  // Announcement read receipts (track who's seen what)
  announcementReads: defineTable({
    announcementId: v.id("announcements"),
    personnelId: v.id("personnel"),
    readAt: v.number(),
  })
    .index("by_announcement", ["announcementId"])
    .index("by_personnel", ["personnelId"])
    .index("by_both", ["announcementId", "personnelId"]),

  // Chat Rooms
  chatRooms: defineTable({
    name: v.string(),
    type: v.string(), // "general" | "department" | "location" | "custom"
    departmentId: v.optional(v.string()), // If department-specific
    locationId: v.optional(v.id("locations")), // If location-specific
    isModerated: v.boolean(), // If true, messages need approval
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_type", ["type"])
    .index("by_active", ["isActive"]),

  // Chat Messages
  chatMessages: defineTable({
    roomId: v.id("chatRooms"),
    personnelId: v.id("personnel"),
    personnelName: v.string(), // Cached for display
    content: v.string(),
    // Moderation
    status: v.string(), // "pending" | "approved" | "rejected"
    moderatedBy: v.optional(v.id("users")),
    moderatedAt: v.optional(v.number()),
    moderationNotes: v.optional(v.string()),
    // Soft delete
    isDeleted: v.boolean(),
    deletedBy: v.optional(v.id("users")),
    deletedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_room", ["roomId"])
    .index("by_room_created", ["roomId", "createdAt"])
    .index("by_personnel", ["personnelId"])
    .index("by_status", ["status"]),

  // Pay Stubs
  payStubs: defineTable({
    personnelId: v.id("personnel"),
    payPeriodStart: v.string(), // YYYY-MM-DD
    payPeriodEnd: v.string(), // YYYY-MM-DD
    payDate: v.string(), // YYYY-MM-DD
    // Hours
    regularHours: v.number(),
    overtimeHours: v.optional(v.number()),
    totalHours: v.number(),
    // Pay
    hourlyRate: v.number(),
    grossPay: v.number(),
    netPay: v.number(),
    // Deductions
    deductions: v.optional(v.array(v.object({
      type: v.string(), // "federal_tax" | "state_tax" | "social_security" | "medicare" | "health_insurance" | "401k" | "other"
      description: v.optional(v.string()),
      amount: v.number(),
    }))),
    totalDeductions: v.number(),
    // File attachment (PDF)
    fileId: v.optional(v.id("_storage")),
    fileName: v.optional(v.string()),
    // Source
    source: v.string(), // "manual" | "quickbooks" | "import"
    externalId: v.optional(v.string()), // QuickBooks ID if synced
    // Notification
    employeeNotifiedAt: v.optional(v.number()),
    employeeViewedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_pay_date", ["payDate"])
    .index("by_personnel_date", ["personnelId", "payDate"]),

  // Timesheet Approvals (CFO workflow)
  // ============ PAYROLL COMPANIES ============
  // For multi-company payroll (separate companies for different entities)
  payrollCompanies: defineTable({
    name: v.string(), // Company name (e.g., "Import Export Tire", "IE Logistics")
    code: v.string(), // Short code (e.g., "IET", "IEL")
    // QuickBooks connection for this company
    qbCompanyName: v.optional(v.string()),
    qbConnectionId: v.optional(v.id("qbConnection")),
    // Departments that belong to this company
    departments: v.array(v.string()), // e.g., ["Warehouse", "Shipping"]
    // Settings
    isActive: v.boolean(),
    payPeriodReference: v.optional(v.string()), // If different pay schedule than default
    payPeriodDays: v.optional(v.number()), // If different pay period length
    // Metadata
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_active", ["isActive"]),

  timesheetApprovals: defineTable({
    payPeriodStart: v.string(), // YYYY-MM-DD
    payPeriodEnd: v.string(), // YYYY-MM-DD
    payrollCompanyId: v.optional(v.id("payrollCompanies")), // Which company this approval is for
    status: v.string(), // "pending" | "approved" | "locked"
    // Summary stats
    totalEmployees: v.number(),
    totalRegularHours: v.number(),
    totalOvertimeHours: v.number(),
    totalHours: v.number(),
    // Issues flagged
    issueCount: v.optional(v.number()), // Missing entries, corrections pending, etc.
    // Approval details
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    approvalNotes: v.optional(v.string()),
    // Lock prevents further edits
    lockedAt: v.optional(v.number()),
    lockedBy: v.optional(v.id("users")),
    // QB export tracking
    exportedToQB: v.optional(v.boolean()),
    exportedAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_pay_period", ["payPeriodStart"])
    .index("by_status", ["status"])
    .index("by_company_period", ["payrollCompanyId", "payPeriodStart"]),

  // Employee App Push Tokens (for notifications)
  employeePushTokens: defineTable({
    personnelId: v.id("personnel"),
    token: v.string(), // Expo push token or FCM token
    platform: v.string(), // "ios" | "android"
    deviceId: v.optional(v.string()), // Unique device identifier
    isActive: v.boolean(),
    lastUsedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_token", ["token"]),

  // PTO Policies (vacation accrual by position)
  ptoPolicies: defineTable({
    position: v.string(), // Job position this applies to, or "default"
    name: v.string(), // "Standard PTO", "Management PTO", etc.
    // Eligibility
    eligibleAfterMonths: v.number(), // Months of employment before eligible (e.g., 12 = 1 year)
    // Annual accrual amounts (in days)
    vacationDaysPerYear: v.number(), // e.g., 10 days
    sickDaysPerYear: v.number(), // e.g., 5 days
    personalDaysPerYear: v.number(), // e.g., 3 days
    // Accrual rules
    accrualMethod: v.string(), // "annual" (all at once) | "monthly" (spread out) | "per_pay_period"
    // Carryover rules
    maxCarryoverDays: v.optional(v.number()), // Max days that can roll over to next year
    // Tenure bonuses (additional days after X years)
    tenureBonuses: v.optional(v.array(v.object({
      afterYears: v.number(), // e.g., 3, 5, 10
      additionalVacationDays: v.number(),
    }))),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_position", ["position"])
    .index("by_active", ["isActive"]),

  // PTO Balances (per employee, per year)
  ptoBalances: defineTable({
    personnelId: v.id("personnel"),
    year: v.number(), // e.g., 2025
    policyId: v.optional(v.id("ptoPolicies")), // Which policy applies
    // Vacation balance
    vacationAccrued: v.number(), // Total accrued this year
    vacationUsed: v.number(), // Total used this year
    vacationPending: v.number(), // Pending requests
    vacationCarriedOver: v.number(), // From previous year
    // Sick balance
    sickAccrued: v.number(),
    sickUsed: v.number(),
    sickPending: v.number(),
    // Personal balance
    personalAccrued: v.number(),
    personalUsed: v.number(),
    personalPending: v.number(),
    // Eligibility date (when they became eligible for PTO)
    eligibleDate: v.optional(v.string()), // YYYY-MM-DD
    // Last accrual date (for monthly/per-pay-period accrual)
    lastAccrualDate: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_year", ["year"])
    .index("by_personnel_year", ["personnelId", "year"]),

  // ============ CALENDAR / EVENTS ============
  events: defineTable({
    title: v.string(),
    description: v.optional(v.string()),
    startTime: v.number(), // Unix timestamp (ms)
    endTime: v.number(), // Unix timestamp (ms)
    isAllDay: v.boolean(),
    location: v.optional(v.string()), // Physical location or virtual
    meetingLink: v.optional(v.string()), // Zoom, Teams, Meet, etc.
    meetingType: v.optional(v.string()), // "zoom" | "teams" | "meet" | "other" | "in_person"
    zoomMeetingId: v.optional(v.number()),
    zoomJoinUrl: v.optional(v.string()),
    zoomAccountId: v.optional(v.id("zoomAccounts")),
    isZoomSynced: v.optional(v.boolean()),
    createdBy: v.id("users"),
    createdByName: v.string(),
    // Link to application (for interview events)
    applicationId: v.optional(v.id("applications")),
    // Recurrence
    isRecurring: v.optional(v.boolean()),
    recurrenceRule: v.optional(v.string()), // RRULE format
    seriesId: v.optional(v.string()),       // groups all occurrences of one series
    // Status
    isCancelled: v.optional(v.boolean()),
    cancelledAt: v.optional(v.number()),
    cancelledBy: v.optional(v.id("users")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_start", ["startTime"])
    .index("by_created_by", ["createdBy"])
    .index("by_created", ["createdAt"])
    .index("by_application", ["applicationId"])
    .index("by_series", ["seriesId"]),

  // Event invitations (who's invited and their response)
  eventInvites: defineTable({
    eventId: v.id("events"),
    userId: v.id("users"),
    status: v.string(), // "pending" | "accepted" | "declined" | "maybe"
    respondedAt: v.optional(v.number()),
    // Notification tracking
    notifiedAt: v.optional(v.number()),
    isRead: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_event", ["eventId"])
    .index("by_user", ["userId"])
    .index("by_user_status", ["userId", "status"])
    .index("by_user_unread", ["userId", "isRead"]),

  // Calendar shares (view someone else's calendar)
  calendarShares: defineTable({
    ownerId: v.id("users"), // The person sharing their calendar
    sharedWithId: v.id("users"), // The person who can view the calendar
    permission: v.string(), // "view" | "edit" (edit = can add events on behalf)
    createdAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_shared_with", ["sharedWithId"])
    .index("by_owner_shared", ["ownerId", "sharedWithId"]),

  // ============ EQUIPMENT / COMPUTERS ============
  // Track company computers and equipment with remote access
  equipment: defineTable({
    name: v.string(), // Computer name or equipment identifier
    type: v.string(), // "computer" | "laptop" | "printer" | "phone" | "other"
    serialNumber: v.optional(v.string()),
    manufacturer: v.optional(v.string()), // Dell, HP, etc.
    model: v.optional(v.string()),
    // For computers
    operatingSystem: v.optional(v.string()), // "Windows 11" | "Windows 10" | "macOS" | "Linux"
    ipAddress: v.optional(v.string()),
    macAddress: v.optional(v.string()),
    ethernetPort: v.optional(v.string()), // Ethernet port if applicable
    // Passwords
    adminPassword: v.optional(v.string()), // Admin password for the computer
    userPassword: v.optional(v.string()), // User password for the computer
    // Chrome Remote Desktop / Remote Access
    chromeRemoteId: v.optional(v.string()), // Chrome Remote Desktop access code/ID
    remoteAccessEnabled: v.boolean(),
    remoteAccessCode: v.optional(v.string()), // Authentication code required on receiving side
    remoteAccessNotes: v.optional(v.string()), // Additional remote connection info
    // Assignment
    assignedTo: v.optional(v.id("personnel")),
    department: v.optional(v.string()),
    location: v.optional(v.string()), // Legacy string location
    locationId: v.optional(v.id("locations")), // Reference to locations table
    // Status
    status: v.string(), // "active" | "in_repair" | "retired" | "storage"
    lastSeenOnline: v.optional(v.number()),
    purchaseDate: v.optional(v.string()),
    warrantyExpiration: v.optional(v.string()),
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_type", ["type"])
    .index("by_status", ["status"])
    .index("by_assigned", ["assignedTo"])
    .index("by_department", ["department"])
    .index("by_locationId", ["locationId"]),

  // ============ QUICKBOOKS DESKTOP INTEGRATION ============
  // QuickBooks connection configuration
  qbConnection: defineTable({
    companyName: v.string(), // QuickBooks company file name
    companyId: v.optional(v.string()), // QB company ID if available
    isActive: v.boolean(),
    // Web Connector settings
    wcPassword: v.string(), // Password for Web Connector authentication (hashed)
    wcUsername: v.string(), // Username for Web Connector
    lastConnectedAt: v.optional(v.number()),
    lastSyncAt: v.optional(v.number()),
    qbVersion: v.optional(v.string()), // QuickBooks version detected
    // Sync settings
    syncTimeEntries: v.boolean(), // Export time entries to QB
    syncPayStubs: v.boolean(), // Import pay stubs from QB
    syncEmployees: v.boolean(), // Sync employee list
    autoSyncEnabled: v.boolean(), // Enable automatic sync
    syncIntervalMinutes: v.number(), // How often to sync (default 15)
    // Status
    connectionStatus: v.string(), // "connected" | "disconnected" | "error" | "pending"
    lastError: v.optional(v.string()),
    lastErrorAt: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"]),

  // Map personnel to QuickBooks employees
  qbEmployeeMapping: defineTable({
    personnelId: v.id("personnel"),
    qbListId: v.string(), // QuickBooks Employee ListID
    qbName: v.string(), // Name as it appears in QuickBooks
    qbEditSequence: v.optional(v.string()), // QB edit sequence for updates
    isActive: v.boolean(),
    isSynced: v.boolean(), // True if successfully synced
    lastSyncedAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_qb_list_id", ["qbListId"])
    .index("by_synced", ["isSynced"]),

  // Queue of items pending sync to QuickBooks
  qbSyncQueue: defineTable({
    type: v.string(), // "time_entry" | "employee" | "paycheck_query"
    action: v.string(), // "add" | "modify" | "query"
    referenceId: v.string(), // ID of the source record (timeEntryId, personnelId, etc.)
    referenceType: v.string(), // "timeEntries" | "personnel" | "payStubs"
    qbRequestXml: v.optional(v.string()), // Generated QBXML request
    status: v.string(), // "pending" | "processing" | "completed" | "failed"
    priority: v.number(), // Lower = higher priority
    attempts: v.number(), // Number of sync attempts
    maxAttempts: v.number(), // Max retry attempts (default 3)
    lastAttemptAt: v.optional(v.number()),
    errorMessage: v.optional(v.string()),
    qbResponseXml: v.optional(v.string()), // Response from QuickBooks
    completedAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_status_priority", ["status", "priority"])
    .index("by_reference", ["referenceType", "referenceId"]),

  // Sync operation logs
  qbSyncLog: defineTable({
    sessionId: v.string(), // Unique session ID for grouping related operations
    operation: v.string(), // "connect" | "sync_time" | "sync_employees" | "import_paychecks" | "error"
    direction: v.string(), // "export" | "import"
    recordType: v.optional(v.string()), // "time_entry" | "employee" | "paycheck"
    recordId: v.optional(v.string()), // Related record ID
    recordCount: v.optional(v.number()), // Number of records processed
    status: v.string(), // "started" | "completed" | "failed"
    message: v.optional(v.string()),
    errorDetails: v.optional(v.string()),
    durationMs: v.optional(v.number()), // How long the operation took
    createdAt: v.number(),
  })
    .index("by_session", ["sessionId"])
    .index("by_operation", ["operation"])
    .index("by_created", ["createdAt"]),

  // Pending time entries for QB export (summary view)
  qbPendingTimeExport: defineTable({
    personnelId: v.id("personnel"),
    weekStartDate: v.string(), // YYYY-MM-DD (Sunday)
    weekEndDate: v.string(), // YYYY-MM-DD (Saturday)
    totalHours: v.number(),
    regularHours: v.number(),
    overtimeHours: v.number(),
    status: v.string(), // "pending" | "approved" | "exported" | "error"
    approvedBy: v.optional(v.id("users")),
    approvedAt: v.optional(v.number()),
    exportedAt: v.optional(v.number()),
    qbTxnId: v.optional(v.string()), // QB Transaction ID after export
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_week", ["weekStartDate"])
    .index("by_status", ["status"])
    .index("by_personnel_week", ["personnelId", "weekStartDate"]),

  // ============ MILEAGE TRACKING (super_admin only) ============
  mileageEntries: defineTable({
    date: v.string(), // YYYY-MM-DD
    fromLocation: v.string(), // Starting location (e.g., "Latrobe, PA")
    toLocation: v.string(), // Destination
    miles: v.number(), // One-way miles
    isRoundTrip: v.boolean(), // If true, miles are doubled for reimbursement
    purpose: v.string(), // Business purpose
    vehicle: v.optional(v.string()), // Vehicle used (e.g., "2022 Ford F-150")
    // Reimbursement calculation
    irsRate: v.number(), // IRS rate at time of entry (e.g., 0.67)
    reimbursementAmount: v.number(), // Calculated: miles * rate (or miles * 2 * rate for round trip)
    // Status
    status: v.string(), // "pending" | "submitted" | "approved" | "paid"
    submittedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    // Notes
    notes: v.optional(v.string()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_date", ["date"])
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"]),

  // ============ EXPENSE REPORTS ============
  // Employee expense reports for reimbursement
  expenseReports: defineTable({
    // Report info
    employeeName: v.string(),
    department: v.string(),
    reportDate: v.string(), // YYYY-MM-DD
    periodStart: v.string(), // YYYY-MM-DD
    periodEnd: v.string(), // YYYY-MM-DD
    purpose: v.optional(v.string()), // Business reason
    // Expense items
    items: v.array(v.object({
      date: v.string(), // YYYY-MM-DD
      description: v.string(),
      category: v.string(),
      amount: v.number(),
      hasReceipt: v.boolean(),
    })),
    totalAmount: v.number(),
    // Status workflow
    status: v.string(), // "draft" | "submitted" | "approved" | "rejected" | "paid"
    submittedAt: v.optional(v.number()),
    approvedAt: v.optional(v.number()),
    approvedBy: v.optional(v.id("users")),
    approvedByName: v.optional(v.string()),
    rejectedAt: v.optional(v.number()),
    rejectedBy: v.optional(v.id("users")),
    rejectionReason: v.optional(v.string()),
    paidAt: v.optional(v.number()),
    paidBy: v.optional(v.id("users")),
    // Notes
    notes: v.optional(v.string()),
    // Tracking
    createdBy: v.id("users"),
    createdByName: v.string(),
    personnelId: v.optional(v.id("personnel")), // Link to personnel record
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_status", ["status"])
    .index("by_created_by", ["createdBy"])
    .index("by_date", ["reportDate"])
    .index("by_personnel", ["personnelId"]),

  // ============ ONBOARDING DOCUMENTS ============
  // Documents that employees must read and sign (e.g., employee handbook)
  onboardingDocuments: defineTable({
    title: v.string(), // e.g., "Employee Handbook"
    description: v.optional(v.string()),
    documentType: v.string(), // "handbook" | "policy" | "agreement" | "form"
    // File storage
    storageId: v.id("_storage"), // PDF file in Convex storage
    fileName: v.string(),
    fileSize: v.number(), // bytes
    pageCount: v.optional(v.number()),
    // Settings
    requiresSignature: v.boolean(), // Must be signed by employees
    isRequired: v.boolean(), // Required for all employees
    isActive: v.boolean(), // Currently in use
    version: v.string(), // e.g., "1.0", "2024-01"
    effectiveDate: v.string(), // When this version became effective
    // Tracking
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_type", ["documentType"])
    .index("by_active", ["isActive"]),

  // Employee signatures on documents
  documentSignatures: defineTable({
    documentId: v.id("onboardingDocuments"),
    personnelId: v.id("personnel"),
    userId: v.optional(v.id("users")), // The user account that signed
    // Signature details
    signedAt: v.number(),
    signatureData: v.optional(v.string()), // Base64 signature image if captured
    ipAddress: v.optional(v.string()),
    deviceInfo: v.optional(v.string()), // Device/browser info
    // Acknowledgment text they agreed to
    acknowledgmentText: v.string(), // e.g., "I have read and agree to the Employee Handbook"
    documentVersion: v.string(), // Version of document at time of signing
    // Initials for disclosure sections
    initialsData: v.optional(v.array(v.object({
      disclosureId: v.string(), // e.g., "at_will", "confidentiality"
      disclosureTitle: v.string(),
      initialsImage: v.string(), // Base64 initials image
      acknowledgedAt: v.number(),
    }))),
    // Stored copy of signed document (for future PDF embedding)
    signedDocumentStorageId: v.optional(v.id("_storage")),
  })
    .index("by_document", ["documentId"])
    .index("by_personnel", ["personnelId"])
    .index("by_document_personnel", ["documentId", "personnelId"]),

  // ============ EMPLOYEE SURVEYS ============
  // Survey templates/campaigns
  surveyCampaigns: defineTable({
    name: v.string(), // e.g., "Weekly Pulse Check", "Monthly Engagement"
    description: v.optional(v.string()),
    isActive: v.boolean(),
    isAnonymous: v.boolean(), // Anonymous responses
    frequency: v.string(), // "once" | "weekly" | "monthly" | "quarterly"
    // Questions in the survey
    questions: v.array(v.object({
      id: v.string(), // Unique ID for the question
      text: v.string(), // Question text
      type: v.string(), // "scale" | "nps" | "text" | "multiple_choice"
      required: v.boolean(),
      options: v.optional(v.array(v.string())), // For multiple choice
      minLabel: v.optional(v.string()), // e.g., "Very Unhappy" for scale
      maxLabel: v.optional(v.string()), // e.g., "Very Happy" for scale
    })),
    // Targeting
    targetDepartments: v.optional(v.array(v.string())), // Specific departments, or all if empty
    targetLocationIds: v.optional(v.array(v.id("locations"))), // Specific locations, or all if empty
    // Schedule
    startDate: v.optional(v.string()), // When to start sending
    endDate: v.optional(v.string()), // When to stop
    lastSentAt: v.optional(v.number()), // Last time surveys were sent
    nextSendAt: v.optional(v.number()), // Next scheduled send
    // Stats
    totalSent: v.number(),
    totalResponses: v.number(),
    // Tracking
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_next_send", ["nextSendAt"]),

  // Individual survey assignments (sent to specific employees)
  surveyAssignments: defineTable({
    campaignId: v.id("surveyCampaigns"),
    personnelId: v.id("personnel"),
    userId: v.optional(v.id("users")), // User account if they have one
    // Status
    status: v.string(), // "pending" | "completed" | "expired"
    sentAt: v.number(),
    completedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), // When the survey expires
    // For non-anonymous, track who
    reminderSentAt: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_personnel", ["personnelId"])
    .index("by_status", ["status"])
    .index("by_campaign_personnel", ["campaignId", "personnelId"]),

  // Survey responses
  surveyResponses: defineTable({
    campaignId: v.id("surveyCampaigns"),
    assignmentId: v.optional(v.id("surveyAssignments")), // Link to assignment
    // For anonymous surveys, personnelId may be null
    personnelId: v.optional(v.id("personnel")),
    department: v.optional(v.string()), // Store department for anonymous aggregation
    locationId: v.optional(v.id("locations")), // Store location for anonymous aggregation
    // Responses - array of question answers
    answers: v.array(v.object({
      questionId: v.string(),
      questionText: v.string(), // Store text for historical reference
      questionType: v.string(),
      value: v.optional(v.union(v.string(), v.number())), // The answer
      numericValue: v.optional(v.number()), // Numeric value for scoring
    })),
    // Calculated scores
    overallScore: v.optional(v.number()), // Average of numeric answers (0-10)
    npsScore: v.optional(v.number()), // NPS score if applicable (-100 to 100)
    // Tracking
    submittedAt: v.number(),
  })
    .index("by_campaign", ["campaignId"])
    .index("by_personnel", ["personnelId"])
    .index("by_submitted", ["submittedAt"])
    .index("by_department", ["department"]),

  // ============ EXIT INTERVIEWS ============
  exitInterviews: defineTable({
    personnelId: v.id("personnel"),
    personnelName: v.string(), // Store name for reference
    department: v.string(),
    position: v.string(),
    hireDate: v.string(),
    terminationDate: v.string(),
    terminationReason: v.optional(v.string()), // From termination record
    // Exit interview status
    // Includes "pending_signoff" / "reversed" added 5/27 for the sign-off
    // workflow alongside the original "pending" / "scheduled" / "completed" / "declined"
    status: v.string(),
    scheduledDate: v.optional(v.string()),
    scheduledTime: v.optional(v.string()),
    scheduledAt: v.optional(v.number()),         // ms — set when calendar event is created
    interviewerUserId: v.optional(v.id("users")),// Andy by default
    calendarEventId: v.optional(v.id("events")), // back-reference to auto-created interview event
    conductedBy: v.optional(v.id("users")),
    conductedByName: v.optional(v.string()),
    completedAt: v.optional(v.number()),
    // Sign-off and 7-day reversible window
    terminatedByUserId: v.optional(v.id("users")),
    terminatedByName: v.optional(v.string()),
    signedOffByUserId: v.optional(v.id("users")),
    signedOffAt: v.optional(v.number()),
    reversibleUntil: v.optional(v.number()),     // ms — sign-off / reversal deadline
    reversedAt: v.optional(v.number()),
    reversedByUserId: v.optional(v.id("users")),
    reversedReason: v.optional(v.string()),
    // Structured reason category (in addition to terminationReason free text)
    leavingCategory: v.optional(v.string()),     // voluntary_quit | involuntary | layoff | performance | attendance | no_call_no_show | other
    // Eligibility / HR handoff
    rehireEligible: v.optional(v.boolean()),
    severancePaid: v.optional(v.boolean()),
    finalPaycheckDate: v.optional(v.string()),
    hrNotes: v.optional(v.string()),
    // Standard questions and responses
    responses: v.optional(v.object({
      primaryReason: v.optional(v.string()), // Main reason for leaving
      wouldReturn: v.optional(v.string()), // "yes" | "no" | "maybe"
      wouldRecommend: v.optional(v.string()), // "yes" | "no" | "maybe"
      satisfactionRating: v.optional(v.number()), // 1-10
      managementRating: v.optional(v.number()), // 1-10
      workLifeBalanceRating: v.optional(v.number()), // 1-10
      compensationRating: v.optional(v.number()), // 1-10
      growthOpportunityRating: v.optional(v.number()), // 1-10
      whatLikedMost: v.optional(v.string()), // Open text
      whatCouldImprove: v.optional(v.string()), // Open text
      additionalComments: v.optional(v.string()), // Open text
    })),
    // Notes from interviewer
    interviewerNotes: v.optional(v.string()),
    // Tracking
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_personnel", ["personnelId"])
    .index("by_status", ["status"])
    .index("by_date", ["terminationDate"]),

  // ============ OFFER LETTERS ============
  offerLetters: defineTable({
    applicationId: v.id("applications"),
    // Candidate info (copied from application)
    candidateName: v.string(),
    candidateEmail: v.string(),
    // Position details
    positionTitle: v.string(),
    department: v.string(),
    locationId: v.optional(v.id("locations")),
    locationName: v.optional(v.string()),
    reportsTo: v.optional(v.string()), // Manager name
    // Compensation
    employmentType: v.string(), // "full_time" | "part_time" | "seasonal" | "contract"
    compensationType: v.string(), // "hourly" | "salary"
    compensationAmount: v.number(), // Hourly rate or annual salary
    payFrequency: v.optional(v.string()), // "weekly" | "biweekly" | "monthly"
    // Schedule
    startDate: v.string(), // Proposed start date
    workSchedule: v.optional(v.string()), // e.g., "Monday-Friday, 8am-5pm"
    // Benefits
    benefitsEligible: v.boolean(),
    benefitsStartDate: v.optional(v.string()),
    ptoAccrual: v.optional(v.string()), // e.g., "2 weeks per year"
    // Offer status
    status: v.string(), // "draft" | "sent" | "viewed" | "accepted" | "declined" | "expired" | "withdrawn"
    sentAt: v.optional(v.number()),
    viewedAt: v.optional(v.number()),
    respondedAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()), // Offer expiration date
    // Response
    declineReason: v.optional(v.string()),
    // Signature
    signedAt: v.optional(v.number()),
    signatureData: v.optional(v.string()), // Base64 signature image
    signedIpAddress: v.optional(v.string()),
    // Generated PDF
    pdfStorageId: v.optional(v.id("_storage")),
    // Custom terms/notes
    additionalTerms: v.optional(v.string()),
    internalNotes: v.optional(v.string()),
    // Tracking
    createdBy: v.id("users"),
    createdByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_application", ["applicationId"])
    .index("by_status", ["status"])
    .index("by_candidate_email", ["candidateEmail"]),

  // ============ TECH WIZARD CHATS ============
  techWizardChats: defineTable({
    title: v.string(), // Auto-generated from first message or user-set
    userId: v.id("users"),
    userName: v.string(),
    messages: v.array(
      v.object({
        role: v.string(), // "user" | "assistant"
        content: v.string(),
        timestamp: v.number(),
      })
    ),
    isArchived: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_updated", ["updatedAt"]),

  // ============ INDEED INTEGRATION ============
  // Logs for tracking Indeed webhook activity
  indeedWebhookLogs: defineTable({
    indeedApplyId: v.string(), // The 64-char unique ID from Indeed
    receivedAt: v.number(),
    applicantName: v.string(),
    applicantEmail: v.string(),
    indeedJobId: v.optional(v.string()),
    indeedJobTitle: v.optional(v.string()),

    // Processing result
    status: v.string(), // "success" | "duplicate" | "error"
    applicationId: v.optional(v.id("applications")),
    errorMessage: v.optional(v.string()),

    // Raw payload for debugging (truncated if too large)
    rawPayload: v.optional(v.string()),
  })
    .index("by_indeed_apply_id", ["indeedApplyId"])
    .index("by_status", ["status"])
    .index("by_received", ["receivedAt"]),

  // Mapping Indeed job postings to internal jobs
  indeedJobMappings: defineTable({
    indeedJobId: v.string(), // Job ID from Indeed
    indeedJobTitle: v.string(), // Job title on Indeed (for reference)
    internalJobId: v.id("jobs"), // Your job ID in the system
    internalJobTitle: v.string(), // Your job title (for reference)
    location: v.optional(v.string()),
    isActive: v.boolean(),
    createdAt: v.number(),
  }).index("by_indeed_job", ["indeedJobId"]),

  // QBWC session storage (needed for serverless environments like AWS Amplify)
  qbwcSessions: defineTable({
    ticket: v.string(), // Unique session ticket
    username: v.string(),
    companyFile: v.string(),
    requestCount: v.number(),
    lastRequest: v.union(v.string(), v.null()),
    createdAt: v.number(),
    expiresAt: v.number(), // Auto-expire stale sessions
  }).index("by_ticket", ["ticket"]),

  // ============ DEALER REBATES ============
  dealerRebateDealers: defineTable({
    jmk: v.string(), // JMK account number (e.g. "125", "r20", "" for standalone Fanatic dealers)
    name: v.string(), // Dealer business name
    fanaticId: v.optional(v.number()), // Falken Fanatic dealer ID
    dealerNumber: v.optional(v.string()), // Milestar Momentum dealer number
    programs: v.array(v.string()), // ["falken"] | ["milestar"] | ["falken","milestar"]
    primSec: v.optional(v.number()), // 1=Primary, 2=Secondary (Falken only)
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_jmk", ["jmk"])
    .index("by_fanatic_id", ["fanaticId"])
    .index("by_dealer_number", ["dealerNumber"])
    .index("by_active", ["isActive"]),

  dealerRebateUploads: defineTable({
    uploadDate: v.number(),
    fileName: v.string(),
    program: v.string(), // "falken" | "milestar"
    totalInputRows: v.number(), // Total CSV rows parsed
    filteredRows: v.number(), // Rows after T-prefix filter
    matchedRows: v.number(), // Invoice lines that matched enrolled dealers (reference)
    matchedQty: v.optional(v.number()), // NET tires (sales positive, returns negative) — the real volume
    dealersMatched: v.number(), // Unique dealers matched
    resultData: v.string(), // JSON stringified output rows
    // Normalized per (dealer, activity-month). qty is NET tires.
    dealerBreakdown: v.array(v.object({
      jmk: v.string(),
      name: v.string(),
      fanaticId: v.optional(v.number()),
      dealerNumber: v.optional(v.string()),
      month: v.optional(v.string()), // "YYYY-MM" from activity date (optional: legacy rows lack it)
      qty: v.optional(v.number()),   // NET tires for this dealer-month (optional: legacy rows lack it)
      rowCount: v.number(),
    })),
    uploadedBy: v.optional(v.id("users")), // optional: automated pipeline has no user
    dateRangeStart: v.optional(v.string()), // Earliest Activity Date in file (MM/DD/YY)
    dateRangeEnd: v.optional(v.string()), // Latest Activity Date in file (MM/DD/YY)
    s3Key: v.optional(v.string()), // Source file key — idempotency for auto-process & backfill
    createdAt: v.number(),
  })
    .index("by_date", ["uploadDate"])
    .index("by_program", ["program"])
    .index("by_uploaded_by", ["uploadedBy"])
    .index("by_s3key_program", ["s3Key", "program"]),

  // ============ DEVELOPMENT CREDENTIALS ============
  // Secure storage for API keys, deploy keys, and other credentials (Development team only)
  credentials: defineTable({
    name: v.string(), // Display name (e.g., "Convex Deploy Key - Prod")
    service: v.string(), // Service name (e.g., "Convex", "Vercel", "AWS", "Stripe")
    keyType: v.string(), // Type (e.g., "deploy_key", "api_key", "secret", "token", "password")
    value: v.string(), // The actual key/credential value
    environment: v.optional(v.string()), // "production" | "development" | "staging"
    project: v.optional(v.string()), // Project name if applicable
    notes: v.optional(v.string()), // Additional notes
    expiresAt: v.optional(v.number()), // Optional expiration date
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_service", ["service"])
    .index("by_type", ["keyType"])
    .index("by_environment", ["environment"]),

  // ============ EMAIL CLIENT ============
  // Default IMAP/SMTP configurations for email domains (super admin managed)
  emailDomainConfigs: defineTable({
    domain: v.string(), // e.g., "company.com", "ietires.com"
    name: v.string(), // Display name, e.g., "Company Email"
    description: v.optional(v.string()), // Help text for users

    // IMAP settings
    imapHost: v.string(),
    imapPort: v.number(),
    imapTls: v.boolean(),

    // SMTP settings
    smtpHost: v.string(),
    smtpPort: v.number(),
    smtpTls: v.boolean(),

    // Whether to use email as username or allow custom
    useEmailAsUsername: v.boolean(),

    // Ordering for display
    sortOrder: v.optional(v.number()),

    isActive: v.boolean(),
    createdBy: v.optional(v.id("users")), // Optional for system-seeded defaults
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_domain", ["domain"])
    .index("by_active", ["isActive"]),

  // Email accounts connected by users
  emailAccounts: defineTable({
    userId: v.id("users"),
    name: v.string(), // Display name (e.g., "Work Gmail", "Personal")
    emailAddress: v.string(), // e.g., "john@company.com"
    provider: v.string(), // "gmail" | "outlook" | "yahoo" | "icloud" | "imap"

    // OAuth2 tokens (for Gmail, Outlook, Yahoo) - ENCRYPTED
    accessToken: v.optional(v.string()),
    refreshToken: v.optional(v.string()),
    tokenExpiresAt: v.optional(v.number()),
    oauthProvider: v.optional(v.string()), // "google" | "microsoft" | "yahoo" | "apple"

    // IMAP/SMTP credentials (for generic IMAP providers) - ENCRYPTED
    imapHost: v.optional(v.string()),
    imapPort: v.optional(v.number()),
    imapUsername: v.optional(v.string()),
    imapPassword: v.optional(v.string()),
    imapTls: v.optional(v.boolean()),
    smtpHost: v.optional(v.string()),
    smtpPort: v.optional(v.number()),
    smtpUsername: v.optional(v.string()),
    smtpPassword: v.optional(v.string()),
    smtpTls: v.optional(v.boolean()),

    // Sync state
    lastSyncAt: v.optional(v.number()),
    syncStatus: v.string(), // "idle" | "syncing" | "error"
    syncError: v.optional(v.string()),
    lastUidValidity: v.optional(v.number()), // IMAP UIDVALIDITY
    lastUid: v.optional(v.number()), // Last synced UID per folder (stored as JSON)

    // Settings
    isActive: v.boolean(),
    isPrimary: v.boolean(), // Primary account for sending
    signature: v.optional(v.string()), // HTML signature

    // Shared mailbox support
    isShared: v.optional(v.boolean()), // If this is a shared mailbox
    sharedWithUserIds: v.optional(v.array(v.id("users"))), // Users who have access

    // Token expiry warning
    tokenExpiryWarned: v.optional(v.boolean()), // If user was warned about expiring token

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["emailAddress"])
    .index("by_user_active", ["userId", "isActive"])
    .index("by_shared", ["isShared"]),

  // Email folders (synced from provider)
  emailFolders: defineTable({
    accountId: v.id("emailAccounts"),
    name: v.string(), // Display name
    path: v.string(), // IMAP path (e.g., "INBOX", "[Gmail]/Sent Mail")
    type: v.string(), // "inbox" | "sent" | "drafts" | "trash" | "spam" | "archive" | "custom"
    unreadCount: v.number(),
    totalCount: v.number(),
    parentPath: v.optional(v.string()), // For nested folders
    flags: v.optional(v.array(v.string())), // IMAP flags
    lastSyncUid: v.optional(v.number()), // Last synced UID for this folder

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_account_type", ["accountId", "type"])
    .index("by_path", ["accountId", "path"]),

  // Cached emails (30-day rolling cache)
  emails: defineTable({
    accountId: v.id("emailAccounts"),
    folderId: v.id("emailFolders"),

    // Provider identifiers
    messageId: v.string(), // Message-ID header
    uid: v.number(), // IMAP UID
    threadId: v.optional(v.string()), // Thread/conversation ID (provider-specific)

    // Headers
    subject: v.string(),
    from: v.object({
      name: v.optional(v.string()),
      address: v.string(),
    }),
    to: v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    })),
    cc: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    }))),
    bcc: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    }))),
    replyTo: v.optional(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    })),
    inReplyTo: v.optional(v.string()), // Message-ID of parent
    references: v.optional(v.array(v.string())), // Message-ID chain

    // Content
    bodyText: v.optional(v.string()), // Plain text body
    bodyHtml: v.optional(v.string()), // HTML body
    snippet: v.string(), // Preview text (first 200 chars)

    // Metadata
    date: v.number(), // Email date timestamp
    receivedAt: v.number(), // When we received/synced it
    size: v.optional(v.number()), // Message size in bytes

    // Flags
    isRead: v.boolean(),
    isStarred: v.boolean(),
    isImportant: v.boolean(),
    isDraft: v.boolean(),
    hasAttachments: v.boolean(),
    labels: v.optional(v.array(v.string())), // Provider labels/tags

    // Security - encrypted content for sensitive emails
    isEncrypted: v.optional(v.boolean()),

    // Snooze support
    snoozedUntil: v.optional(v.number()), // When to resurface
    isSnoozed: v.optional(v.boolean()),

    // Thread metadata
    threadPosition: v.optional(v.number()), // Position in thread (1, 2, 3...)
    threadCount: v.optional(v.number()), // Total emails in thread

    // Internal linking
    linkedConversationId: v.optional(v.id("conversations")), // If converted to internal message
    linkedPersonnelId: v.optional(v.id("personnel")), // If linked to personnel
    linkedApplicationId: v.optional(v.id("applications")), // If linked to applicant

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_folder", ["folderId"])
    .index("by_account_folder", ["accountId", "folderId"])
    .index("by_date", ["accountId", "date"])
    .index("by_thread", ["accountId", "threadId"])
    .index("by_message_id", ["accountId", "messageId"])
    .index("by_received", ["accountId", "receivedAt"])
    .index("by_snoozed", ["accountId", "isSnoozed", "snoozedUntil"]),

  // Email attachments (metadata + storage reference)
  emailAttachments: defineTable({
    emailId: v.id("emails"),
    fileName: v.string(),
    mimeType: v.string(),
    size: v.number(),
    contentId: v.optional(v.string()), // For inline attachments
    isInline: v.boolean(),

    // Storage - always encrypted
    storageId: v.optional(v.id("_storage")), // Convex storage for cached attachments
    externalRef: v.optional(v.string()), // Provider-specific reference for on-demand fetch

    createdAt: v.number(),
  })
    .index("by_email", ["emailId"]),

  // Email drafts (stored separately for autosave)
  emailDrafts: defineTable({
    accountId: v.id("emailAccounts"),
    userId: v.id("users"),

    // If editing existing draft
    existingEmailId: v.optional(v.id("emails")),

    // Compose state
    to: v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    })),
    cc: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    }))),
    bcc: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    }))),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),

    // Reply/forward context
    replyToEmailId: v.optional(v.id("emails")),
    forwardEmailId: v.optional(v.id("emails")),
    mode: v.string(), // "compose" | "reply" | "reply_all" | "forward"

    // Attachments (pending upload)
    attachments: v.optional(v.array(v.object({
      storageId: v.id("_storage"),
      fileName: v.string(),
      mimeType: v.string(),
      size: v.number(),
    }))),

    // Autosave
    lastSavedAt: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_account", ["accountId"]),

  // Email send queue (for retry/tracking)
  emailSendQueue: defineTable({
    accountId: v.id("emailAccounts"),
    userId: v.id("users"),
    draftId: v.optional(v.id("emailDrafts")),

    // Email content (snapshot at send time)
    to: v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    })),
    cc: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    }))),
    bcc: v.optional(v.array(v.object({
      name: v.optional(v.string()),
      address: v.string(),
    }))),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),
    attachmentStorageIds: v.optional(v.array(v.id("_storage"))),

    // Tracking
    status: v.string(), // "pending" | "sending" | "sent" | "failed"
    attempts: v.number(),
    lastAttemptAt: v.optional(v.number()),
    error: v.optional(v.string()),
    sentAt: v.optional(v.number()),
    messageId: v.optional(v.string()), // Provider's message ID
    providerMessageId: v.optional(v.string()), // Provider's message ID (deprecated, use messageId)

    // Schedule (for scheduled send)
    scheduledFor: v.optional(v.number()),

    // Read receipt tracking
    trackingEnabled: v.optional(v.boolean()),
    trackingId: v.optional(v.string()),

    // Retry support
    maxRetries: v.optional(v.number()),
    nextRetryAt: v.optional(v.number()),

    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status"])
    .index("by_scheduled", ["scheduledFor"])
    .index("by_retry", ["status", "nextRetryAt"]),

  // Email sync log (for debugging/auditing)
  emailSyncLogs: defineTable({
    accountId: v.id("emailAccounts"),
    action: v.string(), // "full_sync" | "incremental_sync" | "send" | "delete" | "move" | "flag_update"
    status: v.string(), // "started" | "completed" | "failed"
    details: v.optional(v.string()),
    emailsProcessed: v.optional(v.number()),
    duration: v.optional(v.number()), // ms
    error: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_created", ["createdAt"]),

  // ============ EMAIL ENHANCED FEATURES ============

  // Custom labels/tags for emails
  emailLabels: defineTable({
    userId: v.id("users"),
    name: v.string(),
    color: v.string(), // Hex color code
    description: v.optional(v.string()),
    sortOrder: v.optional(v.number()),
    isSystem: v.boolean(), // System labels can't be deleted

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_name", ["userId", "name"]),

  // Email to label mapping (many-to-many)
  emailLabelAssignments: defineTable({
    emailId: v.id("emails"),
    labelId: v.id("emailLabels"),
    assignedBy: v.id("users"),
    assignedAt: v.number(),
  })
    .index("by_email", ["emailId"])
    .index("by_label", ["labelId"]),

  // Snoozed emails
  emailSnooze: defineTable({
    emailId: v.id("emails"),
    userId: v.id("users"),
    snoozedUntil: v.number(), // When to resurface
    originalFolderId: v.id("emailFolders"), // Where to move back
    isActive: v.boolean(), // False when unsnoozed

    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["emailId"])
    .index("by_snooze_time", ["isActive", "snoozedUntil"]),

  // Email templates
  emailTemplates: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    subject: v.string(),
    bodyHtml: v.string(),
    bodyText: v.optional(v.string()),
    category: v.optional(v.string()), // For organization
    isShared: v.boolean(), // If true, visible to all users
    usageCount: v.number(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_shared", ["isShared"])
    .index("by_category", ["userId", "category"]),

  // Read receipts / email tracking
  emailReadReceipts: defineTable({
    emailId: v.id("emails"), // The sent email being tracked
    sendQueueId: v.optional(v.id("emailSendQueue")),
    recipientEmail: v.string(),
    trackingId: v.string(), // Unique tracking pixel ID

    // Tracking data
    openedAt: v.optional(v.number()),
    openCount: v.number(),
    lastOpenedAt: v.optional(v.number()),
    userAgent: v.optional(v.string()),
    ipAddress: v.optional(v.string()),

    // Link tracking
    linksClicked: v.optional(v.array(v.object({
      url: v.string(),
      clickedAt: v.number(),
    }))),

    createdAt: v.number(),
  })
    .index("by_email", ["emailId"])
    .index("by_tracking_id", ["trackingId"])
    .index("by_recipient", ["recipientEmail"]),

  // Shared mailboxes
  sharedMailboxes: defineTable({
    accountId: v.id("emailAccounts"),
    name: v.string(),
    description: v.optional(v.string()),

    // Access control
    ownerUserId: v.id("users"),
    memberUserIds: v.array(v.id("users")),
    permissions: v.object({
      canRead: v.boolean(),
      canSend: v.boolean(),
      canDelete: v.boolean(),
      canManageMembers: v.boolean(),
    }),

    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_owner", ["ownerUserId"])
    .index("by_member", ["memberUserIds"]),

  // Contact cache for autocomplete
  emailContacts: defineTable({
    userId: v.id("users"),
    email: v.string(),
    name: v.optional(v.string()),

    // Frequency tracking for smart suggestions
    sendCount: v.number(),
    receiveCount: v.number(),
    lastContactedAt: v.number(),

    // Linked to internal personnel if applicable
    personnelId: v.optional(v.id("personnel")),

    // User can mark as favorite or blocked
    isFavorite: v.boolean(),
    isBlocked: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_user_email", ["userId", "email"])
    .index("by_user_favorite", ["userId", "isFavorite"])
    .index("by_frequency", ["userId", "sendCount"]),

  // Email analytics (aggregated stats)
  emailAnalytics: defineTable({
    accountId: v.id("emailAccounts"),
    userId: v.id("users"),
    period: v.string(), // "daily" | "weekly" | "monthly"
    periodStart: v.number(), // Start of period timestamp

    // Volume metrics
    emailsSent: v.number(),
    emailsReceived: v.number(),
    emailsRead: v.number(),
    emailsReplied: v.number(),

    // Time metrics
    avgResponseTimeMs: v.optional(v.number()),
    fastestResponseMs: v.optional(v.number()),
    slowestResponseMs: v.optional(v.number()),

    // Hour distribution (0-23 -> count)
    hourlyDistribution: v.optional(v.array(v.number())),

    // Top contacts
    topSenders: v.optional(v.array(v.object({
      email: v.string(),
      count: v.number(),
    }))),
    topRecipients: v.optional(v.array(v.object({
      email: v.string(),
      count: v.number(),
    }))),

    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_user", ["userId"])
    .index("by_period", ["accountId", "period", "periodStart"]),

  // Email audit log (detailed action tracking)
  emailAuditLog: defineTable({
    userId: v.id("users"),
    accountId: v.optional(v.id("emailAccounts")),
    emailId: v.optional(v.id("emails")),

    action: v.string(), // "view" | "send" | "delete" | "move" | "label" | "star" | "archive" | "export" | "forward"
    details: v.optional(v.string()), // JSON with additional context

    // Context
    ipAddress: v.optional(v.string()),
    userAgent: v.optional(v.string()),

    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_email", ["emailId"])
    .index("by_account", ["accountId"])
    .index("by_action", ["action", "createdAt"])
    .index("by_created", ["createdAt"]),

  // Email retry queue (for failed sends)
  emailRetryQueue: defineTable({
    sendQueueId: v.id("emailSendQueue"),
    userId: v.id("users"),
    accountId: v.id("emailAccounts"),

    // Retry state
    retryCount: v.number(),
    maxRetries: v.number(),
    nextRetryAt: v.number(),
    lastError: v.string(),

    // Notification
    userNotified: v.boolean(),

    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_next_retry", ["nextRetryAt"])
    .index("by_send_queue", ["sendQueueId"]),

  // Email search index (for full-text search caching)
  emailSearchIndex: defineTable({
    emailId: v.id("emails"),
    accountId: v.id("emailAccounts"),
    userId: v.id("users"),

    // Searchable text (normalized, lowercase)
    searchText: v.string(), // Combined subject + body + sender + recipients

    // For filtering
    fromAddress: v.string(),
    toAddresses: v.array(v.string()),
    hasAttachment: v.boolean(),
    date: v.number(),

    createdAt: v.number(),
  })
    .index("by_account", ["accountId"])
    .index("by_user", ["userId"])
    .index("by_email", ["emailId"])
    .searchIndex("search_emails", {
      searchField: "searchText",
      filterFields: ["accountId", "userId", "fromAddress", "hasAttachment"],
    }),

  // ============ VIDEO MEETINGS ============
  meetings: defineTable({
    eventId: v.optional(v.id("events")),
    title: v.string(),
    joinCode: v.string(),
    hostId: v.id("users"),
    hostName: v.string(),
    scheduledStart: v.optional(v.number()),
    scheduledEnd: v.optional(v.number()),
    status: v.string(), // "scheduled" | "lobby" | "active" | "ended"
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    isNotedMeeting: v.boolean(),
    meetingNotesId: v.optional(v.id("meetingNotes")),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_join_code", ["joinCode"])
    .index("by_host", ["hostId"])
    .index("by_event", ["eventId"])
    .index("by_status", ["status"])
    .index("by_scheduled", ["scheduledStart"]),

  meetingParticipants: defineTable({
    meetingId: v.id("meetings"),
    userId: v.optional(v.id("users")),
    guestName: v.optional(v.string()),
    guestEmail: v.optional(v.string()),
    displayName: v.string(),
    status: v.string(), // "lobby" | "connected" | "disconnected" | "removed"
    joinedAt: v.optional(v.number()),
    leftAt: v.optional(v.number()),
    isMuted: v.boolean(),
    isCameraOff: v.boolean(),
    isScreenSharing: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_user", ["userId"])
    .index("by_meeting_status", ["meetingId", "status"]),

  meetingInvites: defineTable({
    meetingId: v.id("meetings"),
    email: v.string(),
    name: v.optional(v.string()),
    inviteToken: v.string(),
    status: v.string(), // "sent" | "opened" | "joined" | "declined"
    sentAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_meeting", ["meetingId"])
    .index("by_token", ["inviteToken"])
    .index("by_email", ["email"]),

  meetingNotes: defineTable({
    meetingId: v.id("meetings"),
    status: v.string(), // "recording" | "uploading" | "transcribing" | "generating" | "complete" | "error"
    audioFileId: v.optional(v.id("_storage")),
    audioS3Key: v.optional(v.string()),
    transcript: v.optional(v.string()),
    summary: v.optional(v.string()),
    actionItems: v.optional(
      v.array(
        v.object({
          text: v.string(),
          assignee: v.optional(v.string()),
          dueDate: v.optional(v.string()),
          completed: v.boolean(),
        })
      )
    ),
    decisions: v.optional(v.array(v.string())),
    followUps: v.optional(v.array(v.string())),
    keyTopics: v.optional(v.array(v.string())),
    duration: v.optional(v.number()), // recording duration in seconds
    errorMessage: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_meeting", ["meetingId"]),

  meetingSignals: defineTable({
    meetingId: v.id("meetings"),
    fromParticipantId: v.id("meetingParticipants"),
    toParticipantId: v.id("meetingParticipants"),
    type: v.string(), // "offer" | "answer" | "ice-candidate" | "renegotiate"
    payload: v.string(),
    isConsumed: v.boolean(),
    createdAt: v.number(),
  })
    .index("by_recipient", ["toParticipantId", "isConsumed"])
    .index("by_meeting", ["meetingId"])
    .index("by_created", ["createdAt"]),

  // ============ DOCUMENT VERSIONS ============
  documentVersions: defineTable({
    documentId: v.id("documents"),
    version: v.number(),
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileSize: v.number(),
    fileType: v.string(),
    changeNotes: v.optional(v.string()),
    uploadedBy: v.id("users"),
    uploadedByName: v.string(),
    createdAt: v.number(),
  })
    .index("by_document", ["documentId"]),

  // ============ DOCUMENT TEMPLATES ============
  documentTemplates: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    category: v.string(), // "forms" | "policies" | "sops" | "templates" | "training" | "other"
    fileId: v.id("_storage"),
    fileName: v.string(),
    fileType: v.string(),
    fileSize: v.number(),
    createdBy: v.id("users"),
    createdByName: v.string(),
    usageCount: v.number(),
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_category", ["category"])
    .index("by_active", ["isActive"]),

  // ============ WTD COMMISSION REPORT ============
  wtdCommissionCustomers: defineTable({
    customerName: v.string(),
    customerNumber: v.string(),
    qualifyingDclasses: v.array(v.string()),
    qualifyingBrands: v.array(v.string()), // Brand codes; includes "ALL" for all brands
    commissionType: v.string(), // "percentage" | "flat"
    commissionValue: v.number(), // Percentage (e.g. 5 for 5%) or flat dollar amount per unit
    isActive: v.boolean(),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_customer_number", ["customerNumber"])
    .index("by_active", ["isActive"]),

  wtdCommissionAccess: defineTable({
    userIds: v.array(v.id("users")), // Users granted access regardless of RBAC tier
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }),

  wtdCommissionReports: defineTable({
    customerName: v.string(),
    customerNumber: v.string(),
    startDate: v.string(),
    endDate: v.string(),
    commissionType: v.string(),
    commissionValue: v.number(),
    lineItems: v.array(
      v.object({
        orderNo: v.string(),
        brand: v.string(),
        mfgItemId: v.string(),
        description: v.string(),
        qty: v.number(),
        unitCost: v.number(),
        commissionAmount: v.number(),
      })
    ),
    grandTotal: v.number(),
    lineItemCount: v.number(),
    generatedBy: v.optional(v.id("users")),
    generatedByName: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(), // 12 months from creation for auto-cleanup
  })
    .index("by_customer", ["customerNumber"])
    .index("by_created", ["createdAt"])
    .index("by_expires", ["expiresAt"]),

  // ============ JMK REPORT UPLOADS ============
  jmkReportTypes: defineTable({
    reportCode: v.string(),       // "OEA07V", "ART24T"
    displayName: v.string(),
    description: v.string(),
    expectedColumns: v.array(v.string()),
    filePattern: v.string(),      // e.g. "iet-oea07v"
    acceptedFormats: v.array(v.string()), // [".csv", ".xlsx"]
    s3Prefix: v.string(),         // "jmk-uploads"
    processingTriggers: v.array(v.string()), // ["sales-refresh", "wtd-commission"]
    isActive: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_code", ["reportCode"])
    .index("by_active", ["isActive"]),

  jmkUploadHistory: defineTable({
    reportType: v.string(),
    fileName: v.string(),
    fileSize: v.number(),
    s3Key: v.string(),
    reportingMonth: v.string(),   // "202604"
    reportDate: v.optional(v.string()), // YYYY-MM-DD — business date the snapshot represents (oeival)
    rowCount: v.optional(v.number()),
    dateRangeStart: v.optional(v.string()), // earliest date in file, e.g. "04/01/26"
    dateRangeEnd: v.optional(v.string()),   // latest date in file, e.g. "04/05/26"
    validationStatus: v.string(), // "valid" | "invalid" | "warning"
    validationErrors: v.optional(v.array(v.string())),
    processingStatus: v.string(), // "pending" | "processing" | "complete" | "failed"
    processingResults: v.optional(v.array(v.object({
      trigger: v.string(),
      status: v.string(),
      message: v.optional(v.string()),
      completedAt: v.optional(v.number()),
    }))),
    uploadedBy: v.optional(v.id("users")),
    uploadedByName: v.string(),
    createdAt: v.number(),
  })
    .index("by_report_type", ["reportType"])
    .index("by_month", ["reportingMonth"])
    .index("by_created", ["createdAt"]),

  reportUploadAccess: defineTable({
    userIds: v.array(v.id("users")),
    updatedBy: v.id("users"),
    updatedAt: v.number(),
  }),

  // ============ CIR REPORT RUNS (coverage tracker) ============
  cirReportRuns: defineTable({
    locationCode: v.string(),
    brands: v.array(v.string()),
    generatedBy: v.optional(v.id("users")),
    generatedByName: v.string(),
    createdAt: v.number(),
    s3Key: v.optional(v.string()),     // archived PDF in ietires-sales-data
    rowCount: v.optional(v.number()),  // how many tire rows in the PDF
  })
    .index("by_location_created", ["locationCode", "createdAt"])
    .index("by_created", ["createdAt"]),

  // ============ INVENTORY ADJUSTMENTS (CIR adjustments tab) ============
  inventoryAdjustments: defineTable({
    locationCode: v.string(),                  // OEAVAL 77 location code (R10, W08, etc.)
    itemId: v.string(),                        // OEAVAL 77 item id
    manufacturerName: v.optional(v.string()),  // cached at entry time
    description: v.optional(v.string()),       // cached at entry time
    qtyChange: v.number(),                     // can be positive or negative
    notes: v.optional(v.string()),
    enteredBy: v.optional(v.id("users")),
    enteredByName: v.string(),
    createdAt: v.number(),
  })
    .index("by_location_created", ["locationCode", "createdAt"])
    .index("by_location_item", ["locationCode", "itemId"])
    .index("by_created", ["createdAt"]),

  // ============ SCRATCHPAD (code-shared clipboard between devices) ============
  scratchpadCodes: defineTable({
    code: v.string(),                 // 4-digit "0000"-"9999"
    content: v.string(),
    createdBy: v.optional(v.id("users")),
    createdByName: v.optional(v.string()),
    createdAt: v.number(),
    expiresAt: v.number(),
  })
    .index("by_code", ["code"])
    .index("by_expires", ["expiresAt"]),

  // ============ FTP CONNECTIONS ============
  ftpConnections: defineTable({
    name: v.string(),              // "JMK Tires Catalog"
    host: v.string(),
    port: v.number(),
    username: v.string(),
    password: v.string(),          // AES-256-GCM encrypted
    remotePath: v.string(),        // "/exports/tires/"
    filePattern: v.string(),       // "tires-*.csv"
    sourceType: v.string(),        // "tires" | "oeival" | "oea07v"
    warehouse: v.optional(v.string()),
    frequency: v.string(),         // "hourly" | "daily" | "manual"
    isActive: v.boolean(),
    lastSyncAt: v.optional(v.number()),
    lastSyncStatus: v.optional(v.string()), // "success" | "failed" | "syncing"
    lastSyncError: v.optional(v.string()),
    lastSyncFileName: v.optional(v.string()),
    lastSyncRowCount: v.optional(v.number()),
    createdBy: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_active", ["isActive"])
    .index("by_sourceType", ["sourceType"]),

  // ============ SAVED REPORT CONFIGURATIONS ============
  savedReportConfigs: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    sources: v.array(v.string()),         // ["OEA07V"] or ["OEA07V", "oeival"] for fusion
    selectedColumns: v.array(v.string()),
    excludeTransactions: v.optional(v.array(v.string())),
    filterBrand: v.optional(v.string()),
    filterAccount: v.optional(v.string()),
    filterLocation: v.optional(v.string()),
    filterProductType: v.optional(v.string()),
    filterDclass: v.optional(v.string()),
    negateQty: v.optional(v.boolean()),
    dateRangeType: v.string(),            // "last7", "last30", "thisMonth", "lastMonth", "custom"
    customStartDate: v.optional(v.string()),
    customEndDate: v.optional(v.string()),
    fusionJoinKey: v.optional(v.string()), // "itemId" for cross-source joins
    autoRun: v.boolean(),                  // Auto-generate when data is uploaded
    lastRunAt: v.optional(v.number()),
    lastRunRowCount: v.optional(v.number()),
    createdBy: v.id("users"),
    createdByName: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_created", ["createdAt"])
    .index("by_autoRun", ["autoRun"]),

  // ============ REPORT DATA TABLES ============

  // Upload tracking for report data ingestion
  reportDataUploads: defineTable({
    uploadedBy: v.optional(v.id("users")),
    uploadedByName: v.string(),
    uploadedAt: v.number(),
    sourceType: v.string(),           // "oeival" | "oea07v" | "tires"
    warehouse: v.optional(v.string()), // Required for oea07v
    fileName: v.string(),
    rowCount: v.number(),
    status: v.string(),               // "processing" | "complete" | "error"
    errorMessage: v.optional(v.string()),
    replacedUploadId: v.optional(v.id("reportDataUploads")),
  })
    .index("by_sourceType", ["sourceType", "uploadedAt"])
    .index("by_status", ["status"]),

  // Tire catalog from tires- CSV (~50K rows)
  tireCatalog: defineTable({
    uploadId: v.id("reportDataUploads"),
    itemId: v.string(),
    mfgItemId: v.optional(v.string()),
    mfgName: v.string(),
    mfgId: v.string(),
    model: v.string(),
    size: v.string(),
    rawSize: v.optional(v.number()),
    xlrf: v.optional(v.string()),
    loadIndex: v.optional(v.number()),
    speedRating: v.optional(v.string()),
    plyRating: v.optional(v.string()),
    sidewall: v.optional(v.string()),
    productType: v.string(),
    stockType: v.optional(v.number()),
    season: v.optional(v.string()),
    computedDescription: v.string(),
    // Future-use fields
    weight: v.optional(v.number()),
    utqg: v.optional(v.string()),
    upc: v.optional(v.string()),
    warrantyMiles: v.optional(v.number()),
    treadDepth: v.optional(v.number()),
    runflat: v.optional(v.number()),
    overallDiameter: v.optional(v.number()),
    sectionWidth: v.optional(v.number()),
    measuredRim: v.optional(v.number()),
    rimWidthMin: v.optional(v.number()),
    rimWidthMax: v.optional(v.number()),
    maxLoadSingle: v.optional(v.number()),
    maxAirSingle: v.optional(v.number()),
    maxLoadDual: v.optional(v.number()),
    maxAirDual: v.optional(v.number()),
    fet: v.optional(v.number()),
    ean: v.optional(v.string()),
  })
    .index("by_itemId", ["itemId"])
    .index("by_mfgName", ["mfgName"])
    .index("by_productType", ["productType"])
    .index("by_uploadId", ["uploadId"]),

  // Inventory from OEIVAL export
  inventoryItems: defineTable({
    uploadId: v.id("reportDataUploads"),
    location: v.string(),
    productType: v.string(),
    stockType: v.optional(v.number()),
    dclass: v.string(),               // Decoded (not "Blank"/"Dash"/"colon")
    manufacturerCode: v.string(),
    manufacturerName: v.string(),
    model: v.optional(v.string()),
    itemId: v.string(),
    mfgItemId: v.string(),
    description: v.string(),
    reorderPoint: v.number(),
    qtyOnHand: v.number(),
    qtyCommitted: v.number(),
    qtyAvailable: v.number(),
    priceRetail: v.number(),
    priceCommercial: v.number(),
    priceWholesale: v.number(),
    priceBase: v.number(),
    priceList: v.number(),
    priceAdj: v.number(),
    lastCost: v.number(),
    avgCost: v.number(),
    stdCost: v.number(),
    fet: v.number(),
    extendedValue: v.number(),
  })
    .index("by_location", ["location"])
    .index("by_mfgName", ["manufacturerName"])
    .index("by_productType", ["productType"])
    .index("by_itemId", ["itemId"])
    .index("by_uploadId", ["uploadId"]),

  // Sales history from OEA07V export
  salesHistory: defineTable({
    uploadId: v.id("reportDataUploads"),
    warehouse: v.string(),
    itemId: v.string(),               // Cleaned (trailing : stripped)
    dclass: v.string(),               // Decoded
    mfgItemId: v.string(),
    manufacturerName: v.string(),
    model: v.optional(v.string()),
    description: v.string(),
    productType: v.string(),
    strippedSize: v.optional(v.number()),
    monthlySales: v.string(),         // JSON: { "2024-01": 4, "2024-06": 2, ... }
    total: v.number(),
    availableStock: v.optional(v.number()),
    isColonRow: v.boolean(),
  })
    .index("by_warehouse", ["warehouse"])
    .index("by_mfgName", ["manufacturerName"])
    .index("by_productType", ["productType"])
    .index("by_itemId", ["itemId"])
    .index("by_uploadId", ["uploadId"]),

  // ============ ZOOM INTEGRATION ============
  zoomAccounts: defineTable({
    userId: v.id("users"),
    zoomUserId: v.string(),
    zoomEmail: v.string(),
    displayName: v.optional(v.string()),
    accessToken: v.string(),   // AES-256-GCM encrypted
    refreshToken: v.string(),  // AES-256-GCM encrypted
    tokenExpiresAt: v.number(),
    isActive: v.boolean(),
    lastSyncAt: v.optional(v.number()),
    syncError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_zoom_user", ["zoomUserId"]),

  // ============ WEB PUSH SUBSCRIPTIONS ============
  webPushSubscriptions: defineTable({
    userId: v.id("users"),
    endpoint: v.string(),
    p256dh: v.string(), // Public key
    auth: v.string(), // Auth secret
    userAgent: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_endpoint", ["endpoint"]),

  labelWorkOrders: defineTable({
    title: v.string(),
    labelType: v.string(),              // "tire"
    labels: v.array(v.object({
      itemId: v.string(),
      brand: v.string(),
      model: v.string(),
      sizeDesc: v.string(),
      qty: v.optional(v.number()),
    })),
    copies: v.number(),
    notes: v.optional(v.string()),
    status: v.string(),                 // "open" | "printed"
    createdBy: v.optional(v.id("users")),
    createdByName: v.string(),
    createdAt: v.number(),
    printedAt: v.optional(v.number()),
    printedByName: v.optional(v.string()),
  })
    .index("by_status_created", ["status", "createdAt"])
    .index("by_created", ["createdAt"]),
});

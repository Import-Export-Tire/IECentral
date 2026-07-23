import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

// Get all active jobs
export const getActiveJobs = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_active", (q) => q.eq("isActive", true))
      .collect();
  },
});

// Get all jobs
export const getAll = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("jobs")
      .order("desc")
      .collect();
  },
});

// Get job by ID
export const getById = query({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.jobId);
  },
});

// Get jobs by department
export const getByDepartment = query({
  args: { department: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("jobs")
      .withIndex("by_department", (q) => q.eq("department", args.department))
      .collect();
  },
});

// Create a new job
export const create = mutation({
  args: {
    title: v.string(),
    location: v.string(),
    locations: v.optional(v.array(v.string())), // Multiple locations
    type: v.string(),
    positionType: v.optional(v.string()),
    department: v.string(),
    description: v.string(),
    summary: v.optional(v.string()),
    responsibilities: v.optional(v.array(v.string())),
    requirements: v.optional(v.array(v.string())),
    benefits: v.array(v.string()),
    keywords: v.array(v.string()),
    urgentHiring: v.optional(v.boolean()),
    badgeType: v.optional(v.string()),
    displayOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const jobId = await ctx.db.insert("jobs", {
      ...args,
      status: "open",
      isActive: true,
      createdAt: now,
      updatedAt: now,
    });
    return jobId;
  },
});

// Update a job
export const update = mutation({
  args: {
    jobId: v.id("jobs"),
    title: v.optional(v.string()),
    location: v.optional(v.string()),
    locations: v.optional(v.array(v.string())), // Multiple locations
    type: v.optional(v.string()),
    positionType: v.optional(v.string()),
    department: v.optional(v.string()),
    description: v.optional(v.string()),
    summary: v.optional(v.string()),
    responsibilities: v.optional(v.array(v.string())),
    requirements: v.optional(v.array(v.string())),
    benefits: v.optional(v.array(v.string())),
    keywords: v.optional(v.array(v.string())),
    status: v.optional(v.string()),
    isActive: v.optional(v.boolean()),
    urgentHiring: v.optional(v.boolean()),
    badgeType: v.optional(v.string()),
    displayOrder: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { jobId, ...updates } = args;
    const filteredUpdates = Object.fromEntries(
      Object.entries(updates).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(jobId, {
      ...filteredUpdates,
      updatedAt: Date.now(),
    });
  },
});

// Toggle urgent hiring status
export const toggleUrgentHiring = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    const job = await ctx.db.get(args.jobId);
    if (!job) throw new Error("Job not found");
    await ctx.db.patch(args.jobId, {
      urgentHiring: !job.urgentHiring,
      updatedAt: Date.now(),
    });
  },
});

// Delete a job
export const remove = mutation({
  args: { jobId: v.id("jobs") },
  handler: async (ctx, args) => {
    await ctx.db.delete(args.jobId);
  },
});

// Seed initial jobs (for setup)
export const seedJobs = mutation({
  args: {},
  handler: async (ctx) => {
    // Check if jobs already exist
    const existingJobs = await ctx.db.query("jobs").first();
    if (existingJobs) {
      return { success: false, message: "Jobs already exist" };
    }

    const now = Date.now();

    // Common benefits
    const managementBenefits = ["Health Insurance", "401k Match", "Paid Time Off", "Performance Bonus"];
    const hourlyBenefits = ["Health Insurance", "401k Match", "Paid Time Off", "Peak Season Bonus", "Attendance Bonus"];

    const jobs = [
      // Management Positions
      {
        title: "Warehouse Manager",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "management",
        department: "Operations",
        status: "open",
        description: "Lead and oversee all warehouse operations including inventory management, shipping/receiving, and team supervision. Responsible for maintaining efficiency, safety compliance, and meeting performance targets. Must have experience managing warehouse teams and inventory systems.",
        benefits: managementBenefits,
        keywords: ["warehouse", "management", "leadership", "inventory", "operations", "logistics", "supervisor", "team lead", "distribution", "supply chain"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Department Supervisor",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "management",
        department: "Operations",
        status: "open",
        description: "Supervise daily operations of an assigned warehouse department. Train and mentor team members, ensure productivity goals are met, and maintain quality standards. Previous supervisory experience in a warehouse or distribution environment preferred.",
        benefits: managementBenefits,
        keywords: ["supervisor", "department", "leadership", "team lead", "warehouse", "operations", "training", "management", "coordination"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Shift Supervisor",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "management",
        department: "Operations",
        status: "open",
        description: "Oversee warehouse operations during assigned shift. Coordinate workflow, assign tasks, monitor productivity, and ensure safety protocols are followed. Must be able to work various shifts and have experience leading teams in a fast-paced environment.",
        benefits: managementBenefits,
        keywords: ["shift", "supervisor", "leadership", "team lead", "warehouse", "operations", "night shift", "coordination", "scheduling"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Ecommerce Manager",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "salaried",
        department: "Sales",
        status: "open",
        description: "Manage and grow our ecommerce operations. Oversee online product listings, pricing strategies, and digital marketing efforts. Analyze sales data and optimize for conversions. Experience with ecommerce platforms and tire/automotive industry preferred.",
        benefits: managementBenefits,
        keywords: ["ecommerce", "online sales", "digital marketing", "product management", "analytics", "pricing", "SEO", "marketplace", "amazon", "ebay"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 4,
        createdAt: now,
        updatedAt: now,
      },
      // Hourly Positions
      {
        title: "Inventory Specialist",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Operations",
        status: "open",
        description: "Maintain accurate inventory records using our warehouse management system. Perform cycle counts, investigate discrepancies, and ensure proper stock rotation. Attention to detail and experience with inventory systems required.",
        benefits: hourlyBenefits,
        keywords: ["inventory", "stock", "counting", "WMS", "accuracy", "organization", "data entry", "cycle count", "warehouse"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 5,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Delivery Driver",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Logistics",
        status: "open",
        description: "Deliver tire orders to customers throughout the Chicagoland area. Must have clean driving record and ability to lift up to 75 lbs. CDL preferred but not required. Local routes with daily home time.",
        benefits: hourlyBenefits,
        keywords: ["driver", "delivery", "CDL", "transportation", "logistics", "local", "trucking", "route", "driving"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 6,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Order Picker",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Operations",
        status: "open",
        description: "Pick and prepare customer orders for shipment. Operate forklifts and pallet jacks to retrieve tires from warehouse locations. Fast-paced environment requiring accuracy and attention to detail. Forklift certification a plus.",
        benefits: hourlyBenefits,
        keywords: ["picker", "warehouse", "forklift", "pallet jack", "shipping", "orders", "accuracy", "physical", "lifting"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 7,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Customer Service Specialist",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Sales",
        status: "open",
        description: "Handle customer inquiries via phone and email. Process orders, provide product information, and resolve issues. Tire or automotive industry knowledge helpful. Strong communication skills and customer-focused attitude required.",
        benefits: hourlyBenefits,
        keywords: ["customer service", "phone", "email", "orders", "communication", "support", "sales", "automotive", "tires"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 8,
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const job of jobs) {
      await ctx.db.insert("jobs", job);
    }

    return { success: true, count: jobs.length };
  },
});

// Clear and reseed jobs (for updating job listings)
export const reseedJobs = mutation({
  args: {},
  handler: async (ctx) => {
    // Delete all existing jobs
    const existingJobs = await ctx.db.query("jobs").collect();
    for (const job of existingJobs) {
      await ctx.db.delete(job._id);
    }

    const now = Date.now();

    // Common benefits
    const managementBenefits = ["Health Insurance", "401k Match", "Paid Time Off", "Performance Bonus"];
    const hourlyBenefits = ["Health Insurance", "401k Match", "Paid Time Off", "Peak Season Bonus", "Attendance Bonus"];

    const jobs = [
      // Management Positions
      {
        title: "Warehouse Manager",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "management",
        department: "Operations",
        status: "open",
        description: "Lead and oversee all warehouse operations including inventory management, shipping/receiving, and team supervision. Responsible for maintaining efficiency, safety compliance, and meeting performance targets. Must have experience managing warehouse teams and inventory systems.",
        benefits: managementBenefits,
        keywords: ["warehouse", "management", "leadership", "inventory", "operations", "logistics", "supervisor", "team lead", "distribution", "supply chain"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 1,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Department Supervisor",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "management",
        department: "Operations",
        status: "open",
        description: "Supervise daily operations of an assigned warehouse department. Train and mentor team members, ensure productivity goals are met, and maintain quality standards. Previous supervisory experience in a warehouse or distribution environment preferred.",
        benefits: managementBenefits,
        keywords: ["supervisor", "department", "leadership", "team lead", "warehouse", "operations", "training", "management", "coordination"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 2,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Shift Supervisor",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "management",
        department: "Operations",
        status: "open",
        description: "Oversee warehouse operations during assigned shift. Coordinate workflow, assign tasks, monitor productivity, and ensure safety protocols are followed. Must be able to work various shifts and have experience leading teams in a fast-paced environment.",
        benefits: managementBenefits,
        keywords: ["shift", "supervisor", "leadership", "team lead", "warehouse", "operations", "night shift", "coordination", "scheduling"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 3,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Ecommerce Manager",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "salaried",
        department: "Sales",
        status: "open",
        description: "Manage and grow our ecommerce operations. Oversee online product listings, pricing strategies, and digital marketing efforts. Analyze sales data and optimize for conversions. Experience with ecommerce platforms and tire/automotive industry preferred.",
        benefits: managementBenefits,
        keywords: ["ecommerce", "online sales", "digital marketing", "product management", "analytics", "pricing", "SEO", "marketplace", "amazon", "ebay"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 4,
        createdAt: now,
        updatedAt: now,
      },
      // Hourly Positions
      {
        title: "Inventory Specialist",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Operations",
        status: "open",
        description: "Maintain accurate inventory records using our warehouse management system. Perform cycle counts, investigate discrepancies, and ensure proper stock rotation. Attention to detail and experience with inventory systems required.",
        benefits: hourlyBenefits,
        keywords: ["inventory", "stock", "counting", "WMS", "accuracy", "organization", "data entry", "cycle count", "warehouse"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 5,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Delivery Driver",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Logistics",
        status: "open",
        description: "Deliver tire orders to customers throughout the Chicagoland area. Must have clean driving record and ability to lift up to 75 lbs. CDL preferred but not required. Local routes with daily home time.",
        benefits: hourlyBenefits,
        keywords: ["driver", "delivery", "CDL", "transportation", "logistics", "local", "trucking", "route", "driving"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 6,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Order Picker",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Operations",
        status: "open",
        description: "Pick and prepare customer orders for shipment. Operate forklifts and pallet jacks to retrieve tires from warehouse locations. Fast-paced environment requiring accuracy and attention to detail. Forklift certification a plus.",
        benefits: hourlyBenefits,
        keywords: ["picker", "warehouse", "forklift", "pallet jack", "shipping", "orders", "accuracy", "physical", "lifting"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 7,
        createdAt: now,
        updatedAt: now,
      },
      {
        title: "Customer Service Specialist",
        location: "Bensenville, IL",
        type: "Full-time",
        positionType: "hourly",
        department: "Sales",
        status: "open",
        description: "Handle customer inquiries via phone and email. Process orders, provide product information, and resolve issues. Tire or automotive industry knowledge helpful. Strong communication skills and customer-focused attitude required.",
        benefits: hourlyBenefits,
        keywords: ["customer service", "phone", "email", "orders", "communication", "support", "sales", "automotive", "tires"],
        isActive: true,
        urgentHiring: false,
        displayOrder: 8,
        createdAt: now,
        updatedAt: now,
      },
    ];

    for (const job of jobs) {
      await ctx.db.insert("jobs", job);
    }

    return { success: true, count: jobs.length };
  },
});

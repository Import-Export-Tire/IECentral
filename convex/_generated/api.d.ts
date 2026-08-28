/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as activity from "../activity.js";
import type * as aiInterview from "../aiInterview.js";
import type * as aiMatching from "../aiMatching.js";
import type * as aiTasks from "../aiTasks.js";
import type * as announcements from "../announcements.js";
import type * as applications from "../applications.js";
import type * as attendance from "../attendance.js";
import type * as auditLogs from "../auditLogs.js";
import type * as auth from "../auth.js";
import type * as authGuards from "../authGuards.js";
import type * as broadcastMessages from "../broadcastMessages.js";
import type * as bulkUpload from "../bulkUpload.js";
import type * as callOffs from "../callOffs.js";
import type * as cirReportRuns from "../cirReportRuns.js";
import type * as cleanup from "../cleanup.js";
import type * as contactMessages from "../contactMessages.js";
import type * as credentials from "../credentials.js";
import type * as crons from "../crons.js";
import type * as dailyLogs from "../dailyLogs.js";
import type * as dashboardSettings from "../dashboardSettings.js";
import type * as dealerInquiries from "../dealerInquiries.js";
import type * as dealerRebates from "../dealerRebates.js";
import type * as deletedRecords from "../deletedRecords.js";
import type * as documentFolders from "../documentFolders.js";
import type * as documentSignatures from "../documentSignatures.js";
import type * as documentTemplates from "../documentTemplates.js";
import type * as documents from "../documents.js";
import type * as email_accountActions from "../email/accountActions.js";
import type * as email_accounts from "../email/accounts.js";
import type * as email_analytics from "../email/analytics.js";
import type * as email_audit from "../email/audit.js";
import type * as email_bulkActions from "../email/bulkActions.js";
import type * as email_contacts from "../email/contacts.js";
import type * as email_domainConfigs from "../email/domainConfigs.js";
import type * as email_drafts from "../email/drafts.js";
import type * as email_emails from "../email/emails.js";
import type * as email_encryptionUtils from "../email/encryptionUtils.js";
import type * as email_folders from "../email/folders.js";
import type * as email_integration from "../email/integration.js";
import type * as email_labels from "../email/labels.js";
import type * as email_readReceipts from "../email/readReceipts.js";
import type * as email_search from "../email/search.js";
import type * as email_send from "../email/send.js";
import type * as email_sendMutations from "../email/sendMutations.js";
import type * as email_sharedMailboxes from "../email/sharedMailboxes.js";
import type * as email_snooze from "../email/snooze.js";
import type * as email_sync from "../email/sync.js";
import type * as email_syncMutations from "../email/syncMutations.js";
import type * as email_templates from "../email/templates.js";
import type * as email_tokenRefresh from "../email/tokenRefresh.js";
import type * as emails from "../emails.js";
import type * as employeeChat from "../employeeChat.js";
import type * as employeePortal from "../employeePortal.js";
import type * as employeeReviews from "../employeeReviews.js";
import type * as equipment from "../equipment.js";
import type * as events from "../events.js";
import type * as exitInterviewActions from "../exitInterviewActions.js";
import type * as exitInterviews from "../exitInterviews.js";
import type * as expenseReports from "../expenseReports.js";
import type * as ftpConnections from "../ftpConnections.js";
import type * as groups from "../groups.js";
import type * as holidays from "../holidays.js";
import type * as http from "../http.js";
import type * as indeedActions from "../indeedActions.js";
import type * as indeedIntegration from "../indeedIntegration.js";
import type * as inventoryAdjustments from "../inventoryAdjustments.js";
import type * as jmkUploads from "../jmkUploads.js";
import type * as jobs from "../jobs.js";
import type * as labelWorkOrders from "../labelWorkOrders.js";
import type * as lib_aiClient from "../lib/aiClient.js";
import type * as locations from "../locations.js";
import type * as meetingInviteActions from "../meetingInviteActions.js";
import type * as meetingInvites from "../meetingInvites.js";
import type * as meetingNoteActions from "../meetingNoteActions.js";
import type * as meetingNotes from "../meetingNotes.js";
import type * as meetingParticipants from "../meetingParticipants.js";
import type * as meetingSignaling from "../meetingSignaling.js";
import type * as meetings from "../meetings.js";
import type * as merits from "../merits.js";
import type * as messages from "../messages.js";
import type * as mileage from "../mileage.js";
import type * as notifications from "../notifications.js";
import type * as offerLetters from "../offerLetters.js";
import type * as onboardingDocuments from "../onboardingDocuments.js";
import type * as orgChart from "../orgChart.js";
import type * as outlookAccounts from "../outlookAccounts.js";
import type * as outlookSync from "../outlookSync.js";
import type * as overtime from "../overtime.js";
import type * as payrollCompanies from "../payrollCompanies.js";
import type * as personnel from "../personnel.js";
import type * as projectSuggestions from "../projectSuggestions.js";
import type * as projects from "../projects.js";
import type * as pushNotifications from "../pushNotifications.js";
import type * as quickbooks from "../quickbooks.js";
import type * as reportData from "../reportData.js";
import type * as reports from "../reports.js";
import type * as safetyChecklist from "../safetyChecklist.js";
import type * as safetyReports from "../safetyReports.js";
import type * as savedReports from "../savedReports.js";
import type * as scannerMdm from "../scannerMdm.js";
import type * as scratchpad from "../scratchpad.js";
import type * as search from "../search.js";
import type * as shiftTemplates from "../shiftTemplates.js";
import type * as shifts from "../shifts.js";
import type * as surveys from "../surveys.js";
import type * as systemBanners from "../systemBanners.js";
import type * as tasks from "../tasks.js";
import type * as techWizardChats from "../techWizardChats.js";
import type * as timeClock from "../timeClock.js";
import type * as timeOffRequests from "../timeOffRequests.js";
import type * as timesheetApprovals from "../timesheetApprovals.js";
import type * as training from "../training.js";
import type * as webPush from "../webPush.js";
import type * as writeUps from "../writeUps.js";
import type * as wtdCommission from "../wtdCommission.js";
import type * as zoomAccounts from "../zoomAccounts.js";
import type * as zoomMeetings from "../zoomMeetings.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  activity: typeof activity;
  aiInterview: typeof aiInterview;
  aiMatching: typeof aiMatching;
  aiTasks: typeof aiTasks;
  announcements: typeof announcements;
  applications: typeof applications;
  attendance: typeof attendance;
  auditLogs: typeof auditLogs;
  auth: typeof auth;
  authGuards: typeof authGuards;
  broadcastMessages: typeof broadcastMessages;
  bulkUpload: typeof bulkUpload;
  callOffs: typeof callOffs;
  cirReportRuns: typeof cirReportRuns;
  cleanup: typeof cleanup;
  contactMessages: typeof contactMessages;
  credentials: typeof credentials;
  crons: typeof crons;
  dailyLogs: typeof dailyLogs;
  dashboardSettings: typeof dashboardSettings;
  dealerInquiries: typeof dealerInquiries;
  dealerRebates: typeof dealerRebates;
  deletedRecords: typeof deletedRecords;
  documentFolders: typeof documentFolders;
  documentSignatures: typeof documentSignatures;
  documentTemplates: typeof documentTemplates;
  documents: typeof documents;
  "email/accountActions": typeof email_accountActions;
  "email/accounts": typeof email_accounts;
  "email/analytics": typeof email_analytics;
  "email/audit": typeof email_audit;
  "email/bulkActions": typeof email_bulkActions;
  "email/contacts": typeof email_contacts;
  "email/domainConfigs": typeof email_domainConfigs;
  "email/drafts": typeof email_drafts;
  "email/emails": typeof email_emails;
  "email/encryptionUtils": typeof email_encryptionUtils;
  "email/folders": typeof email_folders;
  "email/integration": typeof email_integration;
  "email/labels": typeof email_labels;
  "email/readReceipts": typeof email_readReceipts;
  "email/search": typeof email_search;
  "email/send": typeof email_send;
  "email/sendMutations": typeof email_sendMutations;
  "email/sharedMailboxes": typeof email_sharedMailboxes;
  "email/snooze": typeof email_snooze;
  "email/sync": typeof email_sync;
  "email/syncMutations": typeof email_syncMutations;
  "email/templates": typeof email_templates;
  "email/tokenRefresh": typeof email_tokenRefresh;
  emails: typeof emails;
  employeeChat: typeof employeeChat;
  employeePortal: typeof employeePortal;
  employeeReviews: typeof employeeReviews;
  equipment: typeof equipment;
  events: typeof events;
  exitInterviewActions: typeof exitInterviewActions;
  exitInterviews: typeof exitInterviews;
  expenseReports: typeof expenseReports;
  ftpConnections: typeof ftpConnections;
  groups: typeof groups;
  holidays: typeof holidays;
  http: typeof http;
  indeedActions: typeof indeedActions;
  indeedIntegration: typeof indeedIntegration;
  inventoryAdjustments: typeof inventoryAdjustments;
  jmkUploads: typeof jmkUploads;
  jobs: typeof jobs;
  labelWorkOrders: typeof labelWorkOrders;
  "lib/aiClient": typeof lib_aiClient;
  locations: typeof locations;
  meetingInviteActions: typeof meetingInviteActions;
  meetingInvites: typeof meetingInvites;
  meetingNoteActions: typeof meetingNoteActions;
  meetingNotes: typeof meetingNotes;
  meetingParticipants: typeof meetingParticipants;
  meetingSignaling: typeof meetingSignaling;
  meetings: typeof meetings;
  merits: typeof merits;
  messages: typeof messages;
  mileage: typeof mileage;
  notifications: typeof notifications;
  offerLetters: typeof offerLetters;
  onboardingDocuments: typeof onboardingDocuments;
  orgChart: typeof orgChart;
  outlookAccounts: typeof outlookAccounts;
  outlookSync: typeof outlookSync;
  overtime: typeof overtime;
  payrollCompanies: typeof payrollCompanies;
  personnel: typeof personnel;
  projectSuggestions: typeof projectSuggestions;
  projects: typeof projects;
  pushNotifications: typeof pushNotifications;
  quickbooks: typeof quickbooks;
  reportData: typeof reportData;
  reports: typeof reports;
  safetyChecklist: typeof safetyChecklist;
  safetyReports: typeof safetyReports;
  savedReports: typeof savedReports;
  scannerMdm: typeof scannerMdm;
  scratchpad: typeof scratchpad;
  search: typeof search;
  shiftTemplates: typeof shiftTemplates;
  shifts: typeof shifts;
  surveys: typeof surveys;
  systemBanners: typeof systemBanners;
  tasks: typeof tasks;
  techWizardChats: typeof techWizardChats;
  timeClock: typeof timeClock;
  timeOffRequests: typeof timeOffRequests;
  timesheetApprovals: typeof timesheetApprovals;
  training: typeof training;
  webPush: typeof webPush;
  writeUps: typeof writeUps;
  wtdCommission: typeof wtdCommission;
  zoomAccounts: typeof zoomAccounts;
  zoomMeetings: typeof zoomMeetings;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};

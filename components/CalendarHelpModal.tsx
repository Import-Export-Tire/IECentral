"use client";

import { useState } from "react";

type Section = "overview" | "events" | "invites" | "sharing" | "views" | "types";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "events", label: "Events", icon: "M12 4v16m8-8H4" },
  { id: "invites", label: "Invitations", icon: "M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { id: "sharing", label: "Sharing", icon: "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" },
  { id: "views", label: "Views", icon: "M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6z" },
  { id: "types", label: "Meeting Types", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
];

function SectionContent({ section, isDark }: { section: Section; isDark: boolean }) {
  const heading = `text-base font-semibold mb-3 ${isDark ? "text-white" : "text-gray-900"}`;
  const text = `text-sm leading-relaxed ${isDark ? "text-slate-300" : "text-gray-600"}`;
  const subtext = `text-xs ${isDark ? "text-slate-400" : "text-gray-500"}`;
  const card = `p-3 rounded-xl ${isDark ? "bg-slate-800/40" : "bg-gray-50"}`;

  switch (section) {
    case "overview":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Your Calendar</h3>
            <p className={text}>
              A shared calendar for scheduling events, meetings, and reminders. Invite teammates, track RSVPs, and share your calendar with others.
            </p>
          </div>

          <div className="space-y-2">
            {[
              { color: isDark ? "bg-cyan-400" : "bg-blue-500", label: "Your events", desc: "Events you created. You're the organizer." },
              { color: isDark ? "bg-emerald-400" : "bg-emerald-500", label: "Accepted invites", desc: "Events you've been invited to and accepted." },
              { color: isDark ? "bg-amber-400" : "bg-amber-500", label: "Pending invites", desc: "Events waiting for your response." },
              { color: isDark ? "bg-purple-400" : "bg-purple-500", label: "Shared calendar", desc: "Events from someone else's calendar you're viewing." },
            ].map((item) => (
              <div key={item.label} className="flex items-center gap-3">
                <span className={`w-3 h-3 rounded-full flex-shrink-0 ${item.color}`} />
                <div>
                  <span className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{item.label}</span>
                  <span className={`text-xs ml-2 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "events":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Creating Events</h3>
            <p className={text}>Click any empty day on the calendar or use the "+ New Event" button.</p>
          </div>

          <div className="space-y-0">
            {[
              { step: "1", title: "Set the basics", desc: "Enter a title (required), pick start and end date/times, or toggle \"All Day\" for full-day events." },
              { step: "2", title: "Choose a meeting type", desc: "Select how the meeting will happen — IE Meeting, Zoom, Teams, Google Meet, In Person, Phone, or Other." },
              { step: "3", title: "Add details", desc: "Optionally add a description, location, and meeting link (URL for virtual meetings)." },
              { step: "4", title: "Invite people", desc: "Search and select teammates to invite. They'll get a notification to accept or decline." },
            ].map((item) => (
              <div key={item.step} className="flex gap-3 py-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  isDark ? "bg-cyan-500/20 text-cyan-400" : "bg-blue-100 text-blue-600"
                }`}>
                  {item.step}
                </div>
                <div>
                  <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{item.title}</p>
                  <p className={subtext}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>

          <p className={subtext}>Click any event on the calendar to view details, edit, add more invitees, or cancel.</p>
        </div>
      );

    case "invites":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Invitations</h3>
            <p className={text}>When someone invites you to an event, you'll see a notification badge on the calendar.</p>
          </div>

          <div className="space-y-2">
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Pending Invites</p>
              <p className={subtext}>Appear in an amber/yellow section at the top of your calendar. Each shows the event title, date, and time with Accept and Decline buttons.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Responding</p>
              <p className={subtext}>Click Accept to add the event to your calendar (shown in green). Click Decline to remove it. The organizer sees your response status.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Badge Count</p>
              <p className={subtext}>The red badge next to "Pending Invites" shows how many unresponded invitations you have. It disappears once all are handled.</p>
            </div>
          </div>
        </div>
      );

    case "sharing":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Calendar Sharing</h3>
            <p className={text}>Share your calendar with teammates so they can see your schedule, or view shared calendars from others.</p>
          </div>

          <div className="space-y-2">
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Sharing your calendar</p>
              <p className={subtext}>Click the "Share" button in the header. Select a teammate and choose their permission level (view or edit). They'll see your calendar in their dropdown.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Viewing shared calendars</p>
              <p className={subtext}>If someone shares their calendar with you, a dropdown appears in the header. Select their name to switch to their calendar view. Events appear in purple.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Revoking access</p>
              <p className={subtext}>Open the Share panel to see who has access. Click remove next to anyone you want to revoke.</p>
            </div>
          </div>
        </div>
      );

    case "views":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Calendar Views</h3>
            <p className={text}>Switch between different views to see your schedule the way you prefer.</p>
          </div>

          <div className="space-y-2">
            {[
              { title: "Month View", desc: "The default view. See an entire month at a glance with event dots on each day. Click a day to see details or create a new event. Shows up to 2 events per day with a \"+X more\" indicator." },
              { title: "Week View", desc: "See 7 days with time slots. Better for seeing exactly when events fall and spotting open time blocks." },
              { title: "Day View", desc: "Detailed hour-by-hour view of a single day. Best for busy days with many events." },
            ].map((item) => (
              <div key={item.title} className={card}>
                <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>{item.title}</p>
                <p className={subtext}>{item.desc}</p>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>Navigation</p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: "< / >", desc: "Previous / Next" },
                { label: "Today", desc: "Jump to today" },
                { label: "Click day", desc: "View / Create" },
              ].map((item) => (
                <div key={item.label} className={`${card} text-center`}>
                  <p className={`text-sm font-mono font-medium ${isDark ? "text-cyan-400" : "text-blue-600"}`}>{item.label}</p>
                  <p className={`text-[10px] mt-0.5 ${isDark ? "text-slate-500" : "text-gray-400"}`}>{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "types":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Meeting Types</h3>
            <p className={text}>When creating an event, choose how the meeting will take place. This helps attendees know what to expect.</p>
          </div>

          <div className="space-y-2">
            {[
              { emoji: "🏢", title: "IE Central Meeting", desc: "Use the built-in IE Meetings system with video, screen sharing, AI notes, and remote control." },
              { emoji: "📹", title: "Zoom", desc: "External Zoom call. Paste the Zoom link in the meeting link field." },
              { emoji: "👥", title: "Microsoft Teams", desc: "External Teams meeting. Paste the Teams link." },
              { emoji: "🎥", title: "Google Meet", desc: "External Google Meet. Paste the Meet link." },
              { emoji: "📍", title: "In Person", desc: "Physical meeting. Use the location field for the room or address." },
              { emoji: "📞", title: "Phone Call", desc: "Voice call. Add the phone number in the description or meeting link." },
              { emoji: "📋", title: "Other", desc: "Any other type of event or reminder." },
            ].map((item) => (
              <div key={item.title} className={`${card} flex items-start gap-3`}>
                <span className="text-lg flex-shrink-0">{item.emoji}</span>
                <div>
                  <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{item.title}</p>
                  <p className={subtext}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );
  }
}

export default function CalendarHelpModal({ isDark }: { isDark: boolean }) {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("overview");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"}`}
        title="How Calendar works"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setOpen(false)}>
          <div className={`absolute inset-0 ${isDark ? "bg-black/70" : "bg-black/40"} backdrop-blur-sm`} />

          <div
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full max-w-2xl max-h-[90vh] rounded-2xl overflow-hidden flex flex-col ${
              isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-gray-200 shadow-2xl"
            }`}
          >
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <div>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Calendar Guide</h2>
                <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Events, invitations, sharing, and scheduling</p>
              </div>
              <button onClick={() => setOpen(false)} className={`p-1.5 rounded-lg transition-colors ${isDark ? "hover:bg-slate-700 text-slate-400" : "hover:bg-gray-100 text-gray-500"}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex flex-1 overflow-hidden">
              <div className={`w-44 flex-shrink-0 border-r overflow-y-auto py-2 ${isDark ? "border-slate-700/50 bg-slate-900/50" : "border-gray-100 bg-gray-50/50"}`}>
                {SECTIONS.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSection(s.id)}
                    className={`w-full flex items-center gap-2.5 px-4 py-2.5 text-sm transition-colors text-left ${
                      activeSection === s.id
                        ? isDark ? "bg-cyan-500/10 text-cyan-400 border-r-2 border-cyan-400" : "bg-blue-50 text-blue-700 border-r-2 border-blue-600"
                        : isDark ? "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50" : "text-gray-600 hover:text-gray-900 hover:bg-gray-100"
                    }`}
                  >
                    <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={s.icon} />
                    </svg>
                    {s.label}
                  </button>
                ))}
              </div>

              <div className="flex-1 overflow-y-auto p-6">
                <SectionContent section={activeSection} isDark={isDark} />
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

"use client";

import { useState } from "react";

type Section = "overview" | "noted" | "remote" | "joining" | "scheduling" | "companion";

const SECTIONS: { id: Section; label: string; icon: string }[] = [
  { id: "overview", label: "Overview", icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" },
  { id: "noted", label: "AI Notes", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { id: "remote", label: "Remote Control", icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
  { id: "joining", label: "Joining", icon: "M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" },
  { id: "scheduling", label: "Scheduling", icon: "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" },
  { id: "companion", label: "Companion App", icon: "M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" },
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
            <h3 className={heading}>IE Meetings</h3>
            <p className={text}>
              Built-in video conferencing with HD video, screen sharing, AI meeting notes, and remote desktop control — all at zero cost with no external accounts needed.
            </p>
          </div>

          <div className="space-y-2">
            {[
              { icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", title: "AI Meeting Notes", desc: "Automatic transcription, summaries, action items, and key decisions." },
              { icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", title: "Remote Desktop Control", desc: "Take control of a participant's screen for hands-on IT support." },
              { icon: "M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945", title: "Works with Anyone", desc: "Share a join code — external guests don't need an account." },
              { icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14", title: "HD Video & Screen Sharing", desc: "High-quality video with one-click screen sharing." },
              { icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z", title: "Private & Secure", desc: "Peer-to-peer connections. No data stored on third-party servers." },
            ].map((item) => (
              <div key={item.title} className={`${card} flex items-start gap-3`}>
                <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDark ? "text-cyan-400" : "text-blue-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                </svg>
                <div>
                  <p className={`text-sm font-medium ${isDark ? "text-white" : "text-gray-900"}`}>{item.title}</p>
                  <p className={subtext}>{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      );

    case "noted":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>AI Meeting Notes</h3>
            <p className={text}>
              Enable "Noted Meeting" when creating a meeting to have AI automatically capture everything discussed.
            </p>
          </div>

          <div className="space-y-0">
            {[
              { step: "1", title: "Enable before the meeting", desc: "Check the \"Noted Meeting\" box when creating a new meeting, or toggle it on during the meeting from the controls bar." },
              { step: "2", title: "Meeting is transcribed", desc: "Audio is transcribed in real-time during the meeting. All participants' speech is captured." },
              { step: "3", title: "AI generates a summary", desc: "After the meeting ends, AI processes the transcript and generates a structured summary with key points." },
              { step: "4", title: "Review notes anytime", desc: "Click \"View Notes\" on any past noted meeting to see the transcript, summary, action items, and decisions." },
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

          <div className={`${card} flex items-start gap-2`}>
            <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDark ? "text-amber-400" : "text-amber-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className={subtext}>Noted meetings are indicated with a badge on meeting cards. Notes are only generated for meetings with this feature enabled.</p>
          </div>
        </div>
      );

    case "remote":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Remote Desktop Control</h3>
            <p className={text}>
              Take control of another participant's screen during a meeting — perfect for IT support, training walkthroughs, or hands-on troubleshooting.
            </p>
          </div>

          <div className="space-y-2">
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>How it works</p>
              <p className={subtext}>The participant shares their screen, then you click "Request Control" in the meeting controls. They get a 30-second prompt to grant or deny access. Once granted, your mouse and keyboard inputs are forwarded to their machine.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>For the controller</p>
              <p className={subtext}>You'll see a "You have control" indicator and a crosshair cursor. Move your mouse and type as if you're on their computer. Click "Release Control" when done.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>For the sharer</p>
              <p className={subtext}>You'll see a remote cursor on your screen showing where they're pointing. You can revoke control at any time by clicking "Revoke Control".</p>
            </div>
          </div>

          <div className={`${card} flex items-start gap-2`}>
            <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDark ? "text-amber-400" : "text-amber-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className={subtext}>Remote control requires the Companion App installed on the participant's computer. Download it from the meetings page.</p>
          </div>
        </div>
      );

    case "joining":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Joining a Meeting</h3>
            <p className={text}>There are two ways to join:</p>
          </div>

          <div className="space-y-2">
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Join with a Code</p>
              <p className={subtext}>Enter the 6-character meeting code (e.g. "ABC123") in the "Join a Meeting" box. Codes are case-insensitive. This works for anyone — even external guests without an account.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Join from Upcoming Meetings</p>
              <p className={subtext}>If you're invited or it's a scheduled meeting, it appears in your "Upcoming Meetings" list. Click "Join" to enter directly.</p>
            </div>
          </div>

          <div>
            <p className={`text-sm font-medium mb-2 ${isDark ? "text-white" : "text-gray-900"}`}>During the meeting</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: "M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z", label: "Mute / Unmute" },
                { icon: "M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14", label: "Camera On/Off" },
                { icon: "M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z", label: "Share Screen" },
                { icon: "M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1", label: "Leave Meeting" },
              ].map((item) => (
                <div key={item.label} className={`${card} flex items-center gap-2`}>
                  <svg className={`w-4 h-4 ${isDark ? "text-cyan-400" : "text-blue-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d={item.icon} />
                  </svg>
                  <span className={`text-xs font-medium ${isDark ? "text-slate-300" : "text-gray-700"}`}>{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      );

    case "scheduling":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Scheduling Meetings</h3>
            <p className={text}>Plan ahead by scheduling meetings for a specific date and time.</p>
          </div>

          <div className="space-y-0">
            {[
              { step: "1", title: "Click \"New Meeting\"", desc: "Opens the meeting creation form." },
              { step: "2", title: "Choose \"Schedule for Later\"", desc: "Switches from instant mode to scheduling mode with date/time fields." },
              { step: "3", title: "Set the details", desc: "Enter a title, pick a date, and set start/end times. Optionally enable Noted Meeting for AI transcription." },
              { step: "4", title: "Share the join code", desc: "A 6-character code is generated automatically. Share it with participants so they can join when the time comes." },
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

          <p className={subtext}>Scheduled meetings appear in everyone's "Upcoming Meetings" list and can be joined from there when it's time.</p>
        </div>
      );

    case "companion":
      return (
        <div className="space-y-4">
          <div>
            <h3 className={heading}>Companion App</h3>
            <p className={text}>
              The Companion App enables remote desktop control during meetings. Install it on any computer you want to be controllable remotely.
            </p>
          </div>

          <div className="space-y-2">
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>macOS <span className="font-normal opacity-70">· Coming soon</span></p>
              <p className={subtext}>The macOS build isn&apos;t available yet — it&apos;s pending Apple notarization. Use the Windows companion in the meantime; remote control of Mac computers will be enabled in a future release.</p>
            </div>
            <div className={card}>
              <p className={`text-sm font-medium mb-1 ${isDark ? "text-white" : "text-gray-900"}`}>Windows</p>
              <p className={subtext}>Download the .exe installer from the meetings page. Run as administrator for full functionality.</p>
            </div>
          </div>

          <div className={`${card} flex items-start gap-2`}>
            <svg className={`w-4 h-4 flex-shrink-0 mt-0.5 ${isDark ? "text-emerald-400" : "text-emerald-500"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            <p className={subtext}>The Companion App only activates during meetings when control is explicitly granted. It does not run in the background or access your screen outside of meetings.</p>
          </div>
        </div>
      );
  }
}

export default function MeetingsHelpModal({ isDark }: { isDark: boolean }) {
  const [open, setOpen] = useState(false);
  const [activeSection, setActiveSection] = useState<Section>("overview");

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={`p-2 rounded-lg transition-colors ${isDark ? "text-slate-400 hover:bg-slate-800 hover:text-slate-200" : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"}`}
        title="How Meetings work"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={() => setOpen(false)}>
          <div className={`absolute inset-0 ${isDark ? "bg-black/70" : "bg-black/40"} backdrop-blur-sm`} />

          <div
            onClick={(e) => e.stopPropagation()}
            className={`relative w-full max-w-2xl mx-4 h-[75vh] rounded-2xl overflow-hidden flex flex-col ${
              isDark ? "bg-slate-900 border border-slate-700" : "bg-white border border-gray-200 shadow-2xl"
            }`}
          >
            <div className={`flex items-center justify-between px-6 py-4 border-b flex-shrink-0 ${isDark ? "border-slate-700" : "border-gray-200"}`}>
              <div>
                <h2 className={`text-lg font-semibold ${isDark ? "text-white" : "text-gray-900"}`}>Meetings Guide</h2>
                <p className={`text-xs mt-0.5 ${isDark ? "text-slate-400" : "text-gray-500"}`}>Video calls, AI notes, and remote desktop control</p>
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

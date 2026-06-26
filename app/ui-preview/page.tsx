"use client";
import { useState } from "react";
import Card from "@/components/ui/Card";
import SectionHeader from "@/components/ui/SectionHeader";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/ui/StatusBadge";
import ScorePill from "@/components/ui/ScorePill";
import RatingScale from "@/components/ui/RatingScale";

export default function UiPreview() {
  const [ratingDemo, setRatingDemo] = useState<number | null>(2);

  return (
    <main className="theme-bg-primary min-h-screen p-8">
      <div className="max-w-3xl mx-auto flex flex-col gap-5">
        {/* Task 2: Card + SectionHeader */}
        <Card>
          <SectionHeader title="Standard card" label="Section" actions={<span className="ui-badge ui-badge-blue">Badge</span>} />
          <p className="theme-text-secondary text-sm">Body text inside a standard card.</p>
        </Card>
        <Card tone="amber">
          <SectionHeader title="Amber callout" actions={<span className="ui-badge ui-badge-amber">Temp</span>} />
          <p className="theme-text-secondary text-sm">Readable in light and dark.</p>
        </Card>

        {/* Task 3: Buttons + StatusBadge */}
        <Card>
          <SectionHeader title="Buttons & status" />
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant="primary">Hire</Button>
            <Button variant="secondary">Add note</Button>
            <Button variant="ghost">Schedule</Button>
            <Button variant="danger">Delete</Button>
            <StatusBadge status="interviewed" />
            <StatusBadge status="hired" />
            <StatusBadge status="rejected" />
          </div>
        </Card>

        {/* Task 4: ScorePill */}
        <Card>
          <SectionHeader title="Score pills" />
          <div className="flex flex-wrap gap-2 items-center">
            <ScorePill score={88} /> <ScorePill score={64} /> <ScorePill score={32} />
            <ScorePill score={88} size="sm" showOutOf /> <ScorePill score={null} />
          </div>
        </Card>

        {/* Task 5: RatingScale */}
        <Card>
          <SectionHeader title="Rating scale" label="Preliminary evaluation" />
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between"><span className="theme-text-secondary text-sm">Communication</span><RatingScale name="Communication" value={ratingDemo} onChange={setRatingDemo} /></div>
            <div className="flex items-center justify-between"><span className="theme-text-secondary text-sm">Reliability (read-only =3)</span><RatingScale name="Reliability" value={3} readOnly /></div>
          </div>
        </Card>
      </div>
    </main>
  );
}

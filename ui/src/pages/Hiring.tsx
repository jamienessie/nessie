import { HiringBoard } from "./hiring/HiringBoard";

// Hiring page entry point. The board is a 5-column kanban (open →
// sourcing → interviewing → trial → recommended). Click a hire card to
// open the detail page at /hiring/:hireId. Closed stages (hired,
// rejected) are hidden behind a toggle.
//
// All AI-driven flows live behind the board: Lena Park (Head of HR)
// auto-generates candidate personas when a hire advances to sourcing,
// runs interview meetings via the meeting room, and drafts scorecards
// from the transcripts. The operator approves at every gate.

export function Hiring() {
  return <HiringBoard />;
}

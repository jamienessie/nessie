import type { Db } from "@nessie/db";
import { companyGeneratorService } from "./company-generator.js";

// ClipMart — share / discover / fork whole companies, agent personas, and
// role packs across Nessie installs. MVP uses an in-process catalog of
// preset prompts; forking a template hands the prompt to the company
// generator. The clean path forward is to (a) replace the in-process
// catalog with a fetch from a public GitHub-hosted registry, and (b) swap
// the generator's template synthesis for an LLM call. Both swaps are
// localised to this file + company-generator.ts.

export interface ClipMartEntry {
  slug: string;
  name: string;
  tagline: string;
  authorHandle: string;
  tags: string[];
  /** Prompt that gets handed to the company generator on "fork". */
  prompt: string;
  /** Quick stats for the catalog card. */
  stats: {
    agents: number;
    departments: number;
    issues: number;
  };
}

const CATALOG: readonly ClipMartEntry[] = [
  {
    slug: "yc-seed-saas",
    name: "YC Seed SaaS",
    tagline: "Classic Y-Combinator seed-stage software company. CEO + CTO + founding engineer + designer.",
    authorHandle: "@paperclip",
    tags: ["b2b", "saas", "seed-stage", "indie"],
    prompt:
      "Y Combinator seed-stage B2B SaaS startup. Five founders' worth of work in a five-person company: CEO, CTO, founding engineer, CMO, designer. First 90 days: prove the wedge, ship the spine, write the narrative, design the first three screens, talk to ten customers a week.",
    stats: { agents: 5, departments: 8, issues: 5 },
  },
  {
    slug: "indie-hacker-solo",
    name: "Indie Hacker, Solo Edition",
    tagline: "One operator + a tiny supporting cast. Optimised for shipping nights and weekends.",
    authorHandle: "@paperclip",
    tags: ["indie-hacker", "solo", "side-project"],
    prompt:
      "Indie hacker shipping a small paid product solo. Want a tight company that ships, markets, and supports without burning out. First 30 days: ship MVP, launch on Reddit and HN, get the first 10 paying users.",
    stats: { agents: 5, departments: 8, issues: 5 },
  },
  {
    slug: "consulting-agency",
    name: "AI Consulting Agency",
    tagline: "Three-founder agency landing pilots, then scaling delivery without scaling headcount.",
    authorHandle: "@paperclip",
    tags: ["agency", "consulting", "services"],
    prompt:
      "Three-founder AI integration consulting agency. First 60 days: land two pilot clients, deliver a polished case study, build a repeatable engagement template, lock in our positioning.",
    stats: { agents: 5, departments: 8, issues: 5 },
  },
  {
    slug: "dtc-newsletter",
    name: "DTC Newsletter Brand",
    tagline: "A newsletter-first DTC brand. Audience-led product. Editorial cadence is the spine.",
    authorHandle: "@paperclip",
    tags: ["media", "dtc", "newsletter", "creator"],
    prompt:
      "DTC brand that leads with a free newsletter and sells a paid product downstream. First 90 days: publish twice a week without misses, ship one paid product to launch, get to 10,000 subscribers.",
    stats: { agents: 5, departments: 8, issues: 5 },
  },
  {
    slug: "open-source-startup",
    name: "Open Source Startup",
    tagline: "OSS-first project with a paid cloud upsell. Community is the moat.",
    authorHandle: "@paperclip",
    tags: ["open-source", "developer-tools", "community"],
    prompt:
      "Open-source developer-tools startup. The project itself is the marketing; the paid cloud is the business. First 90 days: 500 GitHub stars, working self-hosted release, three customers paying for the cloud.",
    stats: { agents: 5, departments: 8, issues: 5 },
  },
];

export function clipmartService(db: Db) {
  const generator = companyGeneratorService(db);

  return {
    list(): readonly ClipMartEntry[] {
      return CATALOG;
    },

    get(slug: string): ClipMartEntry | null {
      return CATALOG.find((e) => e.slug === slug) ?? null;
    },

    async fork(
      slug: string,
      actor?: { actorType: "agent" | "user" | "system"; actorId: string },
    ) {
      const entry = CATALOG.find((e) => e.slug === slug);
      if (!entry) throw new Error(`ClipMart entry not found: ${slug}`);
      return generator.generate(entry.prompt, {}, actor);
    },
  };
}

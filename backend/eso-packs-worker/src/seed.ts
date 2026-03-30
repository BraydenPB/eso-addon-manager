import type { Pack } from "./types";

/**
 * Sample packs with real ESOUI addon IDs.
 * Used by POST /admin/seed in dev only.
 */
export const SEED_PACKS: Pack[] = [
  {
    id: "trial-essentials",
    name: "Trial Essentials",
    description:
      "The core addons every trial group expects you to have. Covers mechanic alerts, DPS/ult sharing, and combat logging.",
    type: "addon-pack",
    tags: ["trial", "pve", "essential"],
    voteCount: 0,
    metadata: {
      createdBy: "kalpa",
      createdAt: "2025-03-27T00:00:00Z",
      updatedAt: "2025-03-27T00:00:00Z",
      version: 1,
    },
    addons: [
      {
        esouiId: 1855,
        name: "Code's Combat Alerts",
        required: true,
        defaultEnabled: true,
        note: "Mechanic alerts for all trials, dungeons, and arenas",
      },
      {
        esouiId: 1355,
        name: "RaidNotifier",
        required: true,
        defaultEnabled: true,
        note: "Trial-specific mechanic warnings and ult sharing",
      },
      {
        esouiId: 1360,
        name: "Combat Metrics",
        required: true,
        defaultEnabled: true,
        note: "DPS meter and fight analysis",
      },
      {
        esouiId: 2311,
        name: "Hodor Reflexes",
        required: true,
        defaultEnabled: true,
        note: "Group DPS & ultimate sharing display",
      },
      {
        esouiId: 1536,
        name: "Action Duration Reminder",
        required: false,
        defaultEnabled: true,
        note: "Buff/skill duration timers on ability bar",
      },
      {
        esouiId: 2528,
        name: "LibCombat",
        required: true,
        defaultEnabled: true,
        note: "Required library for Combat Metrics and Hodor",
      },
    ],
  },
  {
    id: "healer-toolkit",
    name: "Healer Toolkit",
    description:
      "Addons tailored for trial healers: group frames, buff tracking, rez helpers, and setup management.",
    type: "addon-pack",
    tags: ["trial", "pve", "healer"],
    voteCount: 0,
    metadata: {
      createdBy: "kalpa",
      createdAt: "2025-03-27T00:00:00Z",
      updatedAt: "2025-03-27T00:00:00Z",
      version: 1,
    },
    addons: [
      {
        esouiId: 1855,
        name: "Code's Combat Alerts",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 1355,
        name: "RaidNotifier",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 1360,
        name: "Combat Metrics",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 2311,
        name: "Hodor Reflexes",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 1643,
        name: "Bandits User Interface",
        required: false,
        defaultEnabled: true,
        note: "Group frames, buff tracking, and combat stats",
      },
      {
        esouiId: 3170,
        name: "Wizard's Wardrobe",
        required: false,
        defaultEnabled: true,
        note: "Gear/skill setup management for healer and DPS swaps",
      },
      {
        esouiId: 1536,
        name: "Action Duration Reminder",
        required: false,
        defaultEnabled: true,
      },
      {
        esouiId: 2528,
        name: "LibCombat",
        required: true,
        defaultEnabled: true,
      },
    ],
  },
  {
    id: "dps-starter",
    name: "DPS Starter Pack",
    description:
      "Everything a DPS player needs to start parsing and running trials. Includes combat tracking, weaving helpers, and buff monitors.",
    type: "addon-pack",
    tags: ["trial", "pve", "dps", "beginner"],
    voteCount: 0,
    metadata: {
      createdBy: "kalpa",
      createdAt: "2025-03-27T00:00:00Z",
      updatedAt: "2025-03-27T00:00:00Z",
      version: 1,
    },
    addons: [
      {
        esouiId: 1855,
        name: "Code's Combat Alerts",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 1355,
        name: "RaidNotifier",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 1360,
        name: "Combat Metrics",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 2311,
        name: "Hodor Reflexes",
        required: true,
        defaultEnabled: true,
      },
      {
        esouiId: 2373,
        name: "Combat Metronome",
        required: false,
        defaultEnabled: true,
        note: "GCD tracker to improve light-attack weaving",
      },
      {
        esouiId: 1536,
        name: "Action Duration Reminder",
        required: false,
        defaultEnabled: true,
      },
      {
        esouiId: 3170,
        name: "Wizard's Wardrobe",
        required: false,
        defaultEnabled: true,
        note: "Gear/skill setup management",
      },
      {
        esouiId: 2528,
        name: "LibCombat",
        required: true,
        defaultEnabled: true,
      },
    ],
  },
];

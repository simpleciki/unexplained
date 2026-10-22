import type { Flag } from "../types.ts";
import type { SeatResolution } from "../seats.ts";
import type { DetectCtx } from "./context.ts";
import { detectP2 } from "./changes.ts";
import { detectP7 } from "./invoices.ts";
import { detectP6 } from "./norms.ts";
import { detectP1, detectP3 } from "./promises.ts";
import { detectP5 } from "./rejections.ts";
import { detectP4 } from "./rules.ts";
import { detectT10, detectT2, detectT6 } from "./temporal.ts";

export type { DetectCtx } from "./context.ts";

export function runDetectors(ctx: DetectCtx, seats: SeatResolution[], scopes: string[]): Flag[] {
  return [
    detectP1(ctx),
    detectP2(ctx),
    detectP3(ctx),
    detectP4(ctx),
    detectP5(ctx),
    detectP6(ctx),
    detectP7(ctx),
    detectT2(ctx, seats),
    detectT6(ctx, seats, scopes),
    detectT10(ctx, seats),
  ];
}

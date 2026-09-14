import { describe, it, expect } from "vitest";
import { FIXTURES } from "./index";
import { voiceLength, measureLength, allEvents } from "@/model";
import type { TimeSignature } from "@/model";

describe("fixtures", () => {
  Object.entries(FIXTURES).forEach(([name, makeScore]) => {
    describe(name, () => {
      const score = makeScore();

      it("every voice length equals the measure length (except measureRests)", () => {
        for (const part of score.parts) {
          for (const [measureIndex, pm] of part.measures.entries()) {
            // Get the time signature in effect for this measure
            let measureTs: TimeSignature | undefined;
            for (let i = measureIndex; i >= 0; i--) {
              if (score.measures[i]!.timeSig) {
                measureTs = score.measures[i]!.timeSig;
                break;
              }
            }
            if (!measureTs) {
              measureTs = { numerator: 4, denominator: 4 };
            }

            const measLen = measureLength(measureTs);

            for (const [staffIndex, sm] of pm.staves.entries()) {
              for (const voice of sm.voices) {
                // Check if voice is a single measureRest
                const isMeasureRest =
                  voice.items.length === 1 &&
                  voice.items[0]!.kind === "rest" &&
                  voice.items[0]!.measureRest;

                if (!isMeasureRest) {
                  const vLen = voiceLength(voice);
                  const msg =
                    `${name} measure ${measureIndex} staff ${staffIndex} voice ${voice.index}: ` +
                    `voice length ${vLen.num}/${vLen.den} != measure length ${measLen.num}/${measLen.den}`;
                  expect(vLen.num * measLen.den, msg).toBe(measLen.num * vLen.den);
                }
              }
            }
          }
        }
      });

      it("all ids are unique", () => {
        const ids = new Set<string>();

        // Collect measure ids
        for (const m of score.measures) {
          expect(ids.has(m.id), `${name}: duplicate measure id ${m.id}`).toBe(false);
          ids.add(m.id);
        }

        // Collect part ids and staff ids
        for (const part of score.parts) {
          expect(ids.has(part.id), `${name}: duplicate part id ${part.id}`).toBe(false);
          ids.add(part.id);

          for (const staff of part.staves) {
            expect(ids.has(staff.id), `${name}: duplicate staff id ${staff.id}`).toBe(false);
            ids.add(staff.id);
          }
        }

        // Collect voice ids first (avoid duplicates since allEvents yields multiple events per voice)
        const seenVoices = new Set<string>();
        for (const e of allEvents(score)) {
          seenVoices.add(e.voice.id);
        }
        for (const voiceId of seenVoices) {
          expect(ids.has(voiceId), `${name}: duplicate voice id ${voiceId}`).toBe(false);
          ids.add(voiceId);
        }

        // Collect event and note ids
        for (const e of allEvents(score)) {
          const { positioned } = e;
          const event = positioned.event;

          // Add event id
          expect(ids.has(event.id), `${name}: duplicate event id ${event.id}`).toBe(false);
          ids.add(event.id);

          // Add note ids (for note events)
          if (event.kind === "note") {
            for (const note of event.notes) {
              expect(ids.has(note.id), `${name}: duplicate note id ${note.id}`).toBe(false);
              ids.add(note.id);
            }
          }
        }

        // Collect spanner and attachment ids
        for (const spanner of score.spanners) {
          expect(ids.has(spanner.id), `${name}: duplicate spanner id ${spanner.id}`).toBe(false);
          ids.add(spanner.id);
        }

        for (const attachment of score.attachments) {
          expect(ids.has(attachment.id), `${name}: duplicate attachment id ${attachment.id}`).toBe(false);
          ids.add(attachment.id);
        }
      });
    });
  });
});

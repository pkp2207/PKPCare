import { describe, expect, it } from "vitest";

import {
  buildRedFlagMessage,
  detectRedFlags,
  hasRedFlag,
} from "@/lib/ai/red-flags";

const POSITIVE: [string, string][] = [
  ["cardiac", "I have crushing chest pain since this morning"],
  ["cardiac", "pressure in my chest and pain going down my left arm"],
  ["cardiac", "chest pian when I walk"],
  ["cardiac", "my dad is having a heart attack"],
  ["breathing", "I can't breathe properly"],
  ["breathing", "cant breath at all"],
  ["breathing", "shortness of breath and dizzy"],
  ["breathing", "short of breath even sitting"],
  ["breathing", "difficulty breathing since last night"],
  ["breathing", "my baby is turning blue"],
  ["neurological", "her face is drooping on one side"],
  ["neurological", "slurred speech and confusion"],
  ["neurological", "I think my husband is having a stroke"],
  ["neurological", "sudden numbness in arm and face"],
  ["neurological", "worst headache of my life"],
  ["bleeding", "severe bleeding from a deep cut"],
  ["bleeding", "bleeding won't stop"],
  ["bleeding", "I am vomiting blood"],
  ["self_harm", "I want to kill myself"],
  ["self_harm", "thinking about suicide"],
  ["self_harm", "i dont want to live anymore"],
  ["self_harm", "I have been cutting myself"],
  ["self_harm", "sucide thoughts"],
  ["poisoning", "took too many pills last night"],
  ["poisoning", "my child swallowed bleach"],
  ["poisoning", "possible overdose"],
  ["consciousness", "he is unconscious on the floor"],
  ["consciousness", "she had a seizure"],
  ["consciousness", "passed out and hit my head"],
  ["consciousness", "won't wake up"],
  ["allergic", "severe allergic reaction after peanuts"],
  ["allergic", "my throat is swelling and tongue feels tight"],
  ["allergic", "anaphylaxis"],
  ["pregnancy", "I am 30 weeks pregnant and bleeding"],
  ["pregnancy", "heavy bleeding, I'm pregnant"],
  ["pregnancy", "pregnant with severe abdominal pain"],
  ["infant", "my newborn has a fever"],
  ["infant", "baby has high temperature and is floppy"],
  ["infant", "my 6 week old has a temperature"],
  ["other", "temperature of 104 degrees"],
  ["other", "stiff neck and fever"],
  // multilingual starter set
  ["cardiac", "tengo dolor de pecho"],
  ["breathing", "no puedo respirar"],
  ["breathing", "je ne peux pas respirer"],
  ["breathing", "ich habe Atemnot"],
  ["cardiac", "mujhe seene mein dard hai"],
  ["cardiac", "मुझे सीने में दर्द है"],
  ["breathing", "सांस लेने में तकलीफ"],
  ["self_harm", "मैं आत्महत्या करना चाहता हूँ"],
  ["consciousness", "वह बेहोश हो गया"],
  // obfuscation / look-alikes / odd whitespace and case
  ["self_harm", "su1c1de"],
  ["breathing", "CAN'T   BREATHE"],
  ["cardiac", "Chest\npain"],
  ["breathing", "can’t breathe"],
];

const NEGATIVE: string[] = [
  "Annual checkup please",
  "Follow up for my blood pressure medication",
  "Knee pain when climbing stairs",
  "Skin rash on my arm for a week",
  "Need a prescription refill",
  "Back pain after gardening",
  "Mild headache for two days",
  "Sore throat and runny nose",
  "Food poisoning last week, better now",
  "I touched poison ivy",
  "Child vaccination schedule",
  "My 2 year old has a cold with a mild fever",
  "Routine pregnancy checkup, feeling fine",
  "History of stroke in my family, want a screening",
  "I cut myself cooking, need stitches checked",
  "I hurt myself playing football",
  "Review of my asthma inhaler",
  "Heavy period cycle, want to discuss options",
  "Wellness visit and cholesterol test",
  "",
];

// Documented negation decisions.
const NEGATED: string[] = [
  "no chest pain, just a cough",
  "I don't have any shortness of breath",
  "denies chest pain",
  "history of seizures, stable on medication",
  "no bleeding or pain, routine pregnancy visit",
  "I have not had any chest pain",
  "without any trouble breathing",
];

const NOT_NEGATED: string[] = [
  // negation does not extend across "and": the second symptom is flagged (conservative)
  "denies chest pain and difficulty breathing",
  "not sure if it is chest pain",
  "not only chest pain but also sweating",
  "no fever but chest pain since morning",
  "I'm not suicidal but I want to kill myself",
  "no history of seizures, but he is having a seizure now",
];

describe("detectRedFlags: positives", () => {
  it.each(POSITIVE)("[%s] %s", (category, text) => {
    const matches = detectRedFlags(text);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.map((m) => m.category)).toContain(category);
  });
});

describe("detectRedFlags: negatives (no false alarm on routine requests)", () => {
  it.each(NEGATIVE)("%s", (text) => {
    expect(detectRedFlags(text)).toEqual([]);
  });
});

describe("negation handling (documented decision)", () => {
  it.each(NEGATED)("negated: %s", (text) => {
    expect(hasRedFlag(text)).toBe(false);
  });
  it.each(NOT_NEGATED)("still flagged: %s", (text) => {
    expect(hasRedFlag(text)).toBe(true);
  });
  it("never negates self-harm or poisoning", () => {
    expect(hasRedFlag("no suicidal thoughts? actually yes suicidal")).toBe(true);
    expect(hasRedFlag("not an overdose, just checking")).toBe(true);
  });
});

describe("robustness", () => {
  it("does not throw on odd input", () => {
    expect(detectRedFlags(undefined as unknown as string)).toEqual([]);
    expect(detectRedFlags(123 as unknown as string)).toEqual([]);
    expect(detectRedFlags("a".repeat(100000)).length).toBe(0);
  });
  it("is fast on adversarial repetition", () => {
    const start = Date.now();
    detectRedFlags("chest ".repeat(2000) + "pregnant ".repeat(500));
    expect(Date.now() - start).toBeLessThan(1500);
  });
  it("ignores zero-width characters used to split words", () => {
    expect(hasRedFlag("chest​ pain")).toBe(true);
  });
});

describe("buildRedFlagMessage", () => {
  it("is unmistakable and generic by default", () => {
    const msg = buildRedFlagMessage(["cardiac"]);
    expect(msg).toMatch(/emergency services/i);
    expect(msg).toMatch(/nearest emergency department/i);
    expect(msg).not.toMatch(/\b(911|112|999|108)\b/);
  });
  it("includes the configured number only when given", () => {
    expect(buildRedFlagMessage(["cardiac"], "112")).toContain("(112)");
  });
  it("adds support wording for self-harm", () => {
    expect(buildRedFlagMessage(["self_harm"])).toMatch(/crisis line/i);
  });
});

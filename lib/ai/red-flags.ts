// Deterministic emergency ("red flag") detection.
//
// PURE and dependency free: it runs on the server before any model call, and
// in the browser for instant feedback, with the same rules. Safety behaviour
// must never depend on a model, so nothing in this file calls one.
//
// Design decisions (also documented in docs/ai.md):
//  - Bias to FALSE POSITIVES. A needless "call emergency services" banner costs a
//    patient a moment; a missed red flag can cost a life. When in doubt, flag.
//  - Negation is handled narrowly: a symptom is ignored only when a negation
//    cue sits directly in front of it in the same clause ("no chest pain",
//    "I don't have any shortness of breath", "history of seizures"). Phrases like
//    "not sure if chest pain" or "not only chest pain" are NOT negated. Self-harm
//    and poisoning rules are never negated ("I'm not suicidal but ..." still
//    shows the support message).
//  - A bare "stroke" is not a red flag (follow-ups for past strokes are common);
//    stroke SIGNS (face drooping, slurred speech, one-sided weakness, "having a
//    stroke") are.
//  - Misspellings: common typos are enumerated per keyword; a second pass maps
//    digit/symbol look-alikes inside words (su1c1de, br3athe) before matching.
//  - Multilingual coverage is a starting set (Spanish, French, German, romanised
//    and Devanagari Hindi), NOT a complete list. Extend it with your patient
//    population and review it clinically before relying on it.
//  - This list is a safety net, not a triage tool. It will miss things.

export const RED_FLAG_RULES_VERSION = "2026-10-06";

export type RedFlagCategory =
  | "cardiac"
  | "breathing"
  | "neurological"
  | "bleeding"
  | "self_harm"
  | "poisoning"
  | "consciousness"
  | "allergic"
  | "pregnancy"
  | "infant"
  | "other";

export type RedFlagMatch = { ruleId: string; category: RedFlagCategory };

type PatternRule = {
  kind: "pattern";
  id: string;
  category: RedFlagCategory;
  negatable: boolean;
  patterns: string[];
};

// "a" (anchor, e.g. pregnancy) and "b" (symptom) must occur within `distance`
// characters of each other with no sentence terminator between.
type NearRule = {
  kind: "near";
  id: string;
  category: RedFlagCategory;
  a: string[];
  b: string[];
  distance: number;
};

type Rule = PatternRule | NearRule;

// Common misspelling-tolerant fragments.
const CHEST = "(?:chest|chst|cheast|chset|chets|ches)";
const BREATH = "(?:bre+a?th(?:e|es|ing|in)?|breth(?:e|ing)?|breathe)";

const rule = (
  id: string,
  category: RedFlagCategory,
  negatable: boolean,
  patterns: string[],
): PatternRule => ({ kind: "pattern", id, category, negatable, patterns });

const near = (
  id: string,
  category: RedFlagCategory,
  a: string[],
  b: string[],
  distance = 80,
): NearRule => ({ kind: "near", id, category, a, b, distance });

export const RED_FLAG_RULES: readonly Rule[] = [
  // ---- cardiac --------------------------------------------------------------
  rule("chest_pain", "cardiac", true, [
    `\\b${CHEST}\\s*(?:pain|pains|painful|pian|paine|ache|aching|hurts?|hurting|pressure|tightness|tight|heaviness|heavy|discomfort|squeez\\w*|crushing)\\b`,
    `\\b(?:pain|pressure|tightness|discomfort|squeez\\w*|crushing|heaviness)\\s+(?:in|on|across|around|at)\\s+(?:my\\s+|the\\s+|his\\s+|her\\s+)?${CHEST}\\b`,
    "\\bheart\\s*attack\\b",
    "\\bcardiac\\s+arrest\\b",
    "\\bpain\\s+(?:radiating|spreading|going|shooting)\\s+(?:to|down)\\s+(?:my\\s+)?(?:left\\s+)?(?:arm|jaw)\\b",
    // es / fr / de / hi (romanised and Devanagari)
    "\\bdolor\\s+(?:de|en\\s+el)\\s+pecho\\b",
    "\\bataque\\s+(?:al|de)\\s+(?:corazon|cardiaco)\\b",
    "\\bdouleurs?\\s+(?:a\\s+la\\s+poitrine|dans\\s+la\\s+poitrine|thoracique)\\b",
    "\\bcrise\\s+cardiaque\\b",
    "\\bbrustschmerz\\w*",
    "\\bherzinfarkt\\b",
    "\\bseene\\s+(?:me|mein|mai)\\s+(?:dard|jakdan|bhari)",
    "\\bchhati\\s+(?:me|mein|mai)\\s+dard",
    "\\bdil\\s+ka\\s+daura\\b",
    "सीने\\s*में\\s*(?:दर्द|जकड़न)",
    "छाती\\s*में\\s*दर्द",
    "दिल\\s*का\\s*दौरा",
  ]),

  // ---- breathing ------------------------------------------------------------
  rule("breathing", "breathing", true, [
    `\\b(?:can'?t|cant|cannot|can\\s+not|unable\\s+to|not\\s+able\\s+to|couldn'?t|could\\s+not|struggl\\w*\\s+to|hard\\s+to|difficult\\s+to|trouble|difficulty|problems?|hard\\s+time)\\s+(?:to\\s+|with\\s+)?${BREATH}\\b`,
    "\\bshort(?:ness|nes|nss)?\\s+(?:of\\s+)?bre+a?th\\b",
    "\\bgasp(?:s|ing)?\\s+for\\s+(?:air|breath)\\b",
    "\\bstruggling\\s+for\\s+(?:air|breath)\\b",
    "\\bbreathless(?:ness)?\\b",
    "\\b(?:not|stopped|stops|stop)\\s+breathing\\b",
    "\\bchok(?:ing|es|ed)\\b",
    "\\bturning\\s+blue\\b",
    "\\bblue\\s+lips\\b",
    "\\blips\\s+(?:are\\s+|turned\\s+|turning\\s+|look\\s+)?blue\\b",
    "\\b(?:can'?t|cannot|cant)\\s+get\\s+(?:any\\s+)?air\\b",
    "\\bno\\s+puedo\\s+respirar\\b",
    "\\bfalta\\s+de\\s+aire\\b",
    "\\bdificultad\\s+(?:para|al)\\s+respirar\\b",
    "\\bdifficultes?\\s+a\\s+respirer\\b",
    "\\bje\\s+ne\\s+peux\\s+pas\\s+respirer\\b",
    "\\bessoufflement\\b",
    "\\batemnot\\b",
    "\\bkeine\\s+luft\\b",
    "\\bkann\\s+nicht\\s+atmen\\b",
    "\\bsaans\\s+(?:nahi|nahin|lene\\s+(?:me|mein|mai)\\s+(?:takleef|dikkat|problem|pareshani))",
    "\\bdam\\s+ghut",
    "सांस\\s*(?:नहीं|लेने\\s*में\\s*(?:तकलीफ|दिक्कत|परेशानी))",
    "साँस\\s*(?:नहीं|लेने\\s*में\\s*(?:तकलीफ|दिक्कत|परेशानी))",
    "दम\\s*घुट",
  ]),

  // ---- stroke / neurological ------------------------------------------------
  rule("stroke_signs", "neurological", true, [
    "\\bface\\s+(?:is\\s+|has\\s+|was\\s+|started\\s+)?(?:droop\\w*|sagging|numb|falling)",
    "\\bfacial\\s+(?:droop\\w*|weakness|numbness)\\b",
    "\\b(?:droop\\w*|sagging|lopsided|uneven)\\s+(?:face|smile|mouth)\\b",
    "\\bslurr?ed\\s+speech\\b",
    "\\bslurring\\s+(?:my\\s+|his\\s+|her\\s+)?(?:words|speech)\\b",
    "\\bspeech\\s+(?:is\\s+|became\\s+|suddenly\\s+|has\\s+become\\s+)?slurred\\b",
    "\\bcan'?t\\s+(?:speak|talk|form\\s+words|find\\s+words|move\\s+(?:my\\s+|his\\s+|her\\s+|the\\s+|one\\s+side)?\\s*(?:arm|leg|face|left|right|one))",
    "\\b(?:sudden|suddenly)\\s+(?:weakness|numbness|paralysis|confusion|loss\\s+of\\s+(?:vision|balance|sight)|trouble\\s+(?:seeing|speaking|walking)|blindness|vision\\s+loss)\\b",
    "\\bone\\s+side\\s+(?:of\\s+(?:my|the|his|her)\\s+(?:body|face)\\s+)?(?:is\\s+)?(?:weak|numb|paraly[sz]\\w*)",
    "\\b(?:having|suffering|suspected|possible)\\s+(?:a\\s+)?(?:stroke|tia|mini[- ]?stroke)\\b",
    "\\bstroke\\s+(?:symptoms|signs)\\b",
    "\\bhad\\s+a\\s+stroke\\s+(?:just|now|today|this|a\\s+few\\s+minutes)",
    "\\bworst\\s+headache\\s+(?:of\\s+my\\s+life|ever)\\b",
    "\\bthunderclap\\b",
    "\\bsudden\\s+(?:severe|terrible|excruciating|intense)\\s+headache\\b",
    "\\bcara\\s+caida\\b",
    "\\bhabla\\s+arrastrada\\b",
    "\\bderrame\\s+cerebral\\b",
    "\\bavc\\b",
    "\\bschlaganfall\\b",
    "\\blak(?:w|h)a\\b",
    "लकवा",
  ]),

  // ---- severe bleeding ------------------------------------------------------
  rule("severe_bleeding", "bleeding", true, [
    "\\b(?:severe|heavy|profuse|massive|serious|excessive|uncontrol+able|life[- ]threatening|lots\\s+of|a\\s+lot\\s+of)\\s+(?:blood\\s+loss|bleeding|hemorrhag\\w*|haemorrhag\\w*)",
    "\\bbleeding\\s+(?:heavily|profusely|badly|a\\s+lot|non[- ]?stop|through|everywhere|won'?t\\s+stop|wont\\s+stop|will\\s+not\\s+stop|is\\s+not\\s+stopping|not\\s+stopping|cannot\\s+be\\s+stopped|can'?t\\s+be\\s+stopped)",
    "\\b(?:won'?t|wont|will\\s+not|can'?t|cannot|cant)\\s+stop\\s+bleeding\\b",
    "\\b(?:vomit\\w*|throwing\\s+up|coughing\\s+up|coughed\\s+up|spitting\\s+up)\\s+(?:up\\s+)?blood\\b",
    "\\b(?:blood\\s+(?:is\\s+)?(?:gushing|spurting|pouring)|(?:gushing|spurting|pouring)\\s+blood)",
    "\\bh(?:a)?emorrhag\\w*",
    "\\bbleeding\\s+out\\b",
    "\\bblack\\s+tarry\\s+(?:stools?|poop)\\b",
    "\\bsangrado\\s+(?:abundante|intenso|fuerte|severo)\\b",
    "\\bvomit\\w*\\s+sangre\\b",
    "\\bhemorragia\\b",
    "\\bhemorragie\\b",
    "\\bsaignement\\s+(?:abondant|important)\\b",
    "\\bstarke\\s+blutung\\b",
    "\\bkhoon\\s+(?:ki\\s+ulti|band\\s+nahi|bahut)",
    "खून\\s*(?:की\\s*उल्टी|बंद\\s*नहीं|बहुत)",
  ]),

  // ---- suicidal ideation / self-harm (never negated) -------------------------
  rule("self_harm", "self_harm", false, [
    "\\b(?:suicid\\w*|sucid\\w*|suiside|suicde|sucide|sucicide|suicied)",
    "\\bkill(?:ing)?\\s+(?:my\\s*self|me)\\b",
    "\\bend(?:ing)?\\s+(?:my\\s+(?:own\\s+)?life|it\\s+all|everything)\\b",
    "\\btake\\s+my\\s+(?:own\\s+)?life\\b",
    "\\b(?:want(?:ed)?|wanna|wish(?:ed)?|ready|going|planning|plan)\\s+(?:to\\s+)?(?:die|be\\s+dead|end\\s+(?:it|my\\s+life))\\b",
    "\\bdon'?t\\s+want\\s+to\\s+(?:live|be\\s+alive|be\\s+here|exist|wake\\s+up)\\b",
    "\\bno\\s+(?:reason|point)\\s+(?:to|in)\\s+(?:live|living|go(?:ing)?\\s+on|being\\s+alive)\\b",
    "\\bbetter\\s+off\\s+(?:dead|without\\s+me)\\b",
    "\\b(?:want(?:ed)?\\s+to|wanna|going\\s+to|gonna|thinking\\s+(?:of|about)|thoughts?\\s+of|urge\\s+to|planning\\s+to|feel\\s+like|feels?\\s+like)\\s+(?:hurt|harm|injur|cut|kill|burn|punish)\\w*\\s+(?:my\\s*self|myself)\\b",
    "\\b(?:hurting|harming|cutting|injuring|burning)\\s+myself\\b",
    "\\bself[- ]?(?:harm|injur\\w*|mutilat\\w*)\\b",
    "\\bcutting\\s+(?:my\\s+)?(?:wrists?|arms?)\\b",
    "\\bhang(?:ing)?\\s+myself\\b",
    "\\bquiero\\s+morir(?:me)?\\b",
    "\\bsuicidio\\b",
    "\\bmatarme\\b",
    "\\bquitarme\\s+la\\s+vida\\b",
    "\\bje\\s+veux\\s+mourir\\b",
    "\\bme\\s+suicider\\b",
    "\\bmettre\\s+fin\\s+a\\s+(?:mes\\s+jours|ma\\s+vie)\\b",
    "\\bich\\s+will\\s+(?:nicht\\s+mehr\\s+leben|sterben)\\b",
    "\\bselbstmord\\b",
    "\\bsuizid\\w*",
    "\\bmarna\\s+chah(?:ta|ti)\\b",
    "\\bjaan\\s+dena\\b",
    "\\bkhud\\s+ko\\s+(?:khatam|maar|nuksan)",
    "\\b(?:aatm|atm|aatma|atma)hatya\\b",
    "आत्महत्या",
    "मरना\\s*चाहत[ाी]",
    "खुद\\s*को\\s*(?:खत्म|मार|नुकसान)",
  ]),

  // ---- overdose / poisoning (never negated) ----------------------------------
  rule("poisoning", "poisoning", false, [
    "\\boverdos\\w*",
    "\\b(?:took|taken|taking|swallowed|swallow|ate|eaten|ingested|drank|drunk|consumed)\\s+(?:too\\s+many|way\\s+too\\s+many|a\\s+whole|an\\s+entire|the\\s+whole|the\\s+entire|lots\\s+of|a\\s+handful\\s+of|all\\s+(?:of\\s+)?(?:my|the))\\s+(?:\\w+\\s+){0,2}(?:pills?|tablets?|capsules?|medic\\w*|meds|drugs?|paracetamol|acetaminophen|tylenol|aspirin|ibuprofen|insulin)\\b",
    "\\b(?:swallowed|ingested|drank|ate|drunk|inhaled|breathed\\s+in)\\s+(?:some\\s+|a\\s+(?:lot\\s+of\\s+)?|the\\s+)?(?:poison|bleach|antifreeze|detergent|pesticide|insecticide|rat\\s+poison|chemicals?|kerosene|petrol|gasoline|batter(?:y|ies)|cleaning\\s+(?:fluid|product)s?|fumes|carbon\\s+monoxide)",
    "(?<!food\\s)\\bpoison(?:ed|ing|ous)?\\b(?!\\s+(?:ivy|oak|sumac))",
    "\\bcarbon\\s+monoxide\\b",
    "\\b(?:snake|scorpion)\\s*bit(?:e|ten|es)\\b",
    "\\bsobredosis\\b",
    "\\benvenenamiento\\b",
    "\\bsurdose\\b",
    "\\bempoisonn\\w*",
    "\\buberdosis\\b",
    "\\bvergiftung\\b",
    "\\bzeher\\s+(?:kha|pi)",
    "जहर\\s*(?:खा|पी)",
    "ज़हर\\s*(?:खा|पी)",
  ]),

  // ---- unconscious / seizure --------------------------------------------------
  rule("consciousness", "consciousness", true, [
    "\\b(?:unconscious|unresponsive|non[- ]?responsive|not\\s+responding|not\\s+responsive|passed\\s+out|passing\\s+out|pass\\s+out|blacked\\s+out|collapsed|collapse|fainted|fainting|syncope)\\b",
    "\\b(?:lost|loss\\s+of)\\s+consciousness\\b",
    "\\b(?:won'?t|wont|can'?t|cannot|cant|not|unable\\s+to)\\s+(?:wake\\s+up|wake|waking)\\b",
    "\\bseiz(?:ure|ures|ing)\\b",
    "\\bconvuls\\w*",
    "\\b(?:had|having)\\s+(?:a\\s+)?fits?\\b",
    "\\bepileptic\\s+(?:fit|attack|seizure)",
    "\\bstatus\\s+epilepticus\\b",
    "\\binconsciente\\b",
    "\\bdesmay\\w*",
    "\\bataque\\s+epileptico\\b",
    "\\bevanoui\\w*",
    "\\bperdu\\s+connaissance\\b",
    "\\bbewusstlos\\b",
    "\\bkrampfanfall\\b",
    "\\bohnmacht\\b",
    "\\bbehosh\\b",
    "\\bmirgi\\s+(?:ka\\s+)?daura\\b",
    "बेहोश",
    "मिर्गी\\s*का\\s*दौरा",
  ]),

  // ---- severe allergic reaction ------------------------------------------------
  rule("anaphylaxis", "allergic", true, [
    "\\banaphyla\\w*",
    "\\b(?:throat|tongue|lips?|face|mouth)\\s+(?:is\\s+|are\\s+|feels?\\s+|getting\\s+|started\\s+|starting\\s+to\\s+)?(?:swell\\w*|swollen|closing|tight|tightening|puffy)",
    "\\bswell\\w*\\s+(?:of|in)\\s+(?:the\\s+|my\\s+)?(?:throat|tongue|lips?|face)\\b",
    "\\b(?:severe|serious|bad|life[- ]threatening|major|violent)\\s+allergic\\s+(?:reaction|response|attack)\\b",
    "\\b(?:used|using|injected|needed|gave|give|giving)\\s+(?:my\\s+|an?\\s+|the\\s+|his\\s+|her\\s+)?(?:epi\\s*pen|epipen|epinephrine|adrenaline\\s+(?:pen|injector|shot))",
    "\\ballergic\\s+reaction\\b[^.!?;]{0,60}\\b(?:breath|throat|swelling|hives\\s+all\\s+over|dizz\\w+|faint\\w*)",
    "\\breaccion\\s+alergica\\s+grave\\b",
  ]),

  // ---- pregnancy complications ---------------------------------------------------
  near(
    "pregnancy_complication",
    "pregnancy",
    ["\\b(?:pregnan\\w*|expecting|gravid|embarazada|enceinte|schwanger\\w*|garbhavati)\\b"],
    [
      "\\bbleed\\w*",
      "\\bhemorrhag\\w*|\\bhaemorrhag\\w*",
      "\\bsevere\\s+(?:abdominal\\s+|stomach\\s+|belly\\s+|pelvic\\s+)?(?:pain|cramp\\w*)",
      "\\bsharp\\s+(?:abdominal\\s+|pelvic\\s+)?pain",
      "\\bwaters?\\s+broke\\b",
      "\\bcontractions\\b",
      "\\bno\\s+(?:fetal|baby)\\s+movement",
      "\\bbaby\\s+(?:is\\s+)?(?:not|stopped)\\s+mov\\w*",
      "\\bmiscarr\\w*",
      "\\bseizures?\\b",
      "\\bsevere\\s+headache\\b",
      "\\bvision\\s+(?:changes|problems|blurr\\w*)",
      "\\bleaking\\s+fluid\\b",
    ],
    80,
  ),

  // ---- infants -----------------------------------------------------------------
  near(
    "infant_fever",
    "infant",
    ["\\b(?:baby|infant|newborn|neonate|neonatal)\\b"],
    ["\\b(?:fever|febrile|high\\s+temp\\w*|temperature|hot\\s+to\\s+touch)\\b"],
    100,
  ),
  near(
    "infant_unwell",
    "infant",
    ["\\b(?:baby|infant|newborn|neonate)\\b"],
    [
      "\\b(?:floppy|limp|lethargic|unresponsive|not\\s+feeding|refus\\w+\\s+(?:to\\s+)?feed|won'?t\\s+feed|not\\s+breathing|grunting|bulging\\s+fontanelle)\\b",
    ],
    80,
  ),

  // ---- other emergencies -----------------------------------------------------------
  rule("other_emergency", "other", true, [
    "\\bsevere\\s+burns?\\b",
    "\\belectric(?:al)?\\s+shock\\b",
    "\\bdrown(?:ing|ed)\\b",
    "\\bgunshot\\b",
    "\\bstab(?:bed|bing)\\b",
    "\\b(?:severe|serious)\\s+(?:head|neck|spine|spinal)\\s+injur\\w*",
    "\\b(?:temperature|temp|fever)\\b[^0-9.]{0,15}(?:104|105|106|107|41|42)(?:\\.\\d+)?\\s*(?:°|degrees?|deg\\b|f\\b|c\\b)",
  ]),
  near(
    "meningitis_signs",
    "other",
    ["\\bstiff\\s+neck\\b"],
    ["\\b(?:fever|rash|headache|vomit\\w*|confus\\w*|light\\s+sensitiv\\w*)\\b"],
    80,
  ),
];

// ---------------------------------------------------------------------------
// Normalisation + matching helpers
// ---------------------------------------------------------------------------

const MAX_SCAN_CHARS = 4000;

/**
 * Lower-case, strip Latin diacritics (not Devanagari marks), unify
 * apostrophes, drop zero-width / bidi control characters, collapse whitespace.
 */
export const normalizeForRules = (input: string): string =>
  String(input ?? "")
    .slice(0, MAX_SCAN_CHARS)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2018\u2019\u02bc`\u00b4]/g, "'")
    .replace(/[\u200b-\u200f\u202a-\u202e\u2060\ufeff]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

// Second pass: map look-alike digits/symbols inside words that contain letters
// (su1c1de -> suicide). Standalone numbers are untouched.
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "3": "e",
  "@": "a",
  $: "s",
};
export const deLeet = (normalized: string): string =>
  normalized.replace(/\S+/g, (token) =>
    /[a-z]/.test(token) ? token.replace(/[013@$]/g, (c) => LEET[c] ?? c) : token,
  );

const compiled = new Map<string, RegExp>();
const re = (source: string): RegExp => {
  let found = compiled.get(source);
  if (!found) {
    found = new RegExp(source.normalize("NFKD"), "g");
    compiled.set(source, found);
  }
  return found;
};

// Direct cue (optionally followed by a few filler words) at the END of the text
// that precedes a symptom, within the same clause.
const NEGATION_TAIL = new RegExp(
  "(?:\\b(?:no|not|never|without|denies|denied|negative for|free of|absence of|history of|hx of|h/o|past history of|family history of|ruled out|rule out|r/o)|" +
    "\\b(?:do|does|did|have|has|had|am|is|are|was|were)(?:n'?t| not)|" +
    "\\b(?:don'?t|doesn'?t|didn'?t|haven'?t|hasn'?t|hadn'?t))\\s+" +
    "(?:(?:any|a|an|the|my|his|her|their|current|recent|new|more|of|signs?|symptoms?|kind|sort|type|history|have|had|has|get|feel|felt|experience|experienced|having|been|really)\\s+){0,3}$",
);

const CLAUSE_BREAK = /[.,;:!?()\n]|\bbut\b|\bhowever\b|\balthough\b|\bthough\b|\band now\b/g;

const isNegatedAt = (text: string, index: number): boolean => {
  const prefix = text.slice(Math.max(0, index - 60), index);
  let start = 0;
  let m: RegExpExecArray | null;
  const breaker = new RegExp(CLAUSE_BREAK.source, "g");
  while ((m = breaker.exec(prefix)) !== null) {
    start = m.index + m[0].length;
    if (m[0].length === 0) breaker.lastIndex += 1;
  }
  return NEGATION_TAIL.test(prefix.slice(start));
};

type Hit = { index: number; end: number };

const findAll = (text: string, source: string): Hit[] => {
  const hits: Hit[] = [];
  const matches = Array.from(text.matchAll(re(source)));
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const index = match.index ?? 0;
    hits.push({ index, end: index + match[0].length });
  }
  return hits;
};

const TERMINATOR = /[.!?;\n]/;

const evaluatePattern = (text: string, r: PatternRule): boolean => {
  for (let p = 0; p < r.patterns.length; p += 1) {
    const hits = findAll(text, r.patterns[p]);
    for (let h = 0; h < hits.length; h += 1) {
      if (!r.negatable || !isNegatedAt(text, hits[h].index)) return true;
    }
  }
  return false;
};

const evaluateNear = (text: string, r: NearRule): boolean => {
  const anchors: Hit[] = [];
  for (let i = 0; i < r.a.length; i += 1) {
    anchors.push(...findAll(text, r.a[i]).filter((h) => !isNegatedAt(text, h.index)));
  }
  if (anchors.length === 0) return false;

  for (let i = 0; i < r.b.length; i += 1) {
    const symptoms = findAll(text, r.b[i]).filter((h) => !isNegatedAt(text, h.index));
    for (let s = 0; s < symptoms.length; s += 1) {
      for (let a = 0; a < anchors.length; a += 1) {
        const first = anchors[a].index <= symptoms[s].index ? anchors[a] : symptoms[s];
        const second = first === anchors[a] ? symptoms[s] : anchors[a];
        if (second.index - first.end > r.distance) continue;
        const between = text.slice(first.end, Math.max(first.end, second.index));
        if (!TERMINATOR.test(between)) return true;
      }
    }
  }
  return false;
};

// Explicit age under three months plus a fever term in the same sentence.
const YOUNG_AGE = /\b(\d{1,3})[\s-]*(day|wk|week|month|mo)s?[\s-]*(?:old|of age)\b/g;
const FEVER_TERM = /\b(?:fever|febrile|high temp\w*|temperature|hot to touch)\b/;

const youngInfantFever = (text: string): boolean => {
  const matches = Array.from(text.matchAll(YOUNG_AGE));
  for (let i = 0; i < matches.length; i += 1) {
    const value = Number(matches[i][1]);
    const unit = matches[i][2];
    const days =
      unit === "day" ? value : unit === "wk" || unit === "week" ? value * 7 : value * 30;
    if (days > 0 && days < 90) {
      const index = matches[i].index ?? 0;
      const window = text.slice(Math.max(0, index - 100), index + 100);
      if (FEVER_TERM.test(window)) return true;
    }
  }
  return false;
};

// An explicit age of 3 months or more means "baby" alone is not treated as a
// neonate (a one-year-old with a fever is a routine visit).
const OLDER_AGE = /\b(\d{1,3})[\s-]*(month|mo|year|yr)s?[\s-]*(?:old|of age)\b/g;
const hasOlderExplicitAge = (text: string): boolean => {
  const matches = Array.from(text.matchAll(OLDER_AGE));
  for (let i = 0; i < matches.length; i += 1) {
    const value = Number(matches[i][1]);
    const unit = matches[i][2];
    const months = unit === "month" || unit === "mo" ? value : value * 12;
    if (months >= 3) return true;
  }
  return /\b(?:toddler|child|kid|year[- ]old)\b/.test(text);
};

const scan = (text: string): RedFlagMatch[] => {
  const found: RedFlagMatch[] = [];
  const add = (ruleId: string, category: RedFlagCategory) => {
    if (!found.some((f) => f.ruleId === ruleId)) found.push({ ruleId, category });
  };

  for (let i = 0; i < RED_FLAG_RULES.length; i += 1) {
    const r = RED_FLAG_RULES[i];
    if (r.kind === "pattern") {
      if (evaluatePattern(text, r)) add(r.id, r.category);
    } else if (r.id === "infant_fever") {
      if (!hasOlderExplicitAge(text) && evaluateNear(text, r)) add(r.id, r.category);
    } else if (evaluateNear(text, r)) {
      add(r.id, r.category);
    }
  }
  if (youngInfantFever(text)) add("infant_fever_age", "infant");
  return found;
};

/**
 * Returns every red-flag rule matched by `text` (empty array = none matched).
 * Never throws; non-string input yields no matches.
 */
export const detectRedFlags = (text: string): RedFlagMatch[] => {
  try {
    if (typeof text !== "string" || text.length === 0) return [];
    const normalized = normalizeForRules(text);
    const results = scan(normalized);
    const leeted = deLeet(normalized);
    if (leeted !== normalized) {
      const extra = scan(leeted);
      for (let i = 0; i < extra.length; i += 1) {
        if (!results.some((r) => r.ruleId === extra[i].ruleId)) results.push(extra[i]);
      }
    }
    return results;
  } catch {
    // A rules failure must never hide the rest of the page; the caller treats
    // "no match" as "no red flag detected", which is all this module promises.
    return [];
  }
};

export const hasRedFlag = (text: string): boolean => detectRedFlags(text).length > 0;

// ---------------------------------------------------------------------------
// Message
// ---------------------------------------------------------------------------

/**
 * Generic, unmistakable emergency guidance. No country-specific number is
 * baked in; pass the operator-configured number (env EMERGENCY_NUMBER) to
 * include it.
 */
export const buildRedFlagMessage = (
  categories: readonly RedFlagCategory[] = [],
  emergencyNumber?: string,
): string => {
  const number = emergencyNumber ? ` (${emergencyNumber})` : "";
  const parts = [
    `This may be a medical emergency. Call emergency services${number} now or go to the nearest emergency department. Do not wait for an appointment or for online advice.`,
    "If you can, ask someone to stay with you.",
  ];
  if (categories.includes("self_harm")) {
    parts.push(
      "If you are thinking about harming yourself, contact emergency services or a crisis line in your area right away and tell someone you trust how you are feeling.",
    );
  }
  return parts.join(" ");
};

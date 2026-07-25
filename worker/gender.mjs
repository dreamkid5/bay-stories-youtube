// Decide whether a first-person story is told by / about a man or a woman, so the
// tool can pick the matching narrator voice (female -> Jenny, male -> Brian) and the
// matching presenter portrait, automatically. Free, no API: it counts the gendered
// words in the script and goes with the majority. Returns "male" or "female".

const FEMALE = /\b(she|her|hers|herself|woman|women|girl|girls|lady|ladies|mother|mom|mum|mama|sister|wife|daughter|girlfriend|aunt|grandmother|grandma|niece|queen|princess|widow|bride|female|madam|mrs|miss|ms)\b/gi;
const MALE = /\b(he|him|his|himself|man|men|boy|boys|guy|guys|gentleman|father|dad|daddy|papa|brother|husband|son|boyfriend|uncle|grandfather|grandpa|nephew|king|prince|widower|groom|male|sir|mr)\b/gi;

export function detectGender(script, fallback = "female") {
  const text = " " + String(script || "") + " ";
  const f = (text.match(FEMALE) || []).length;
  const m = (text.match(MALE) || []).length;
  if (f === 0 && m === 0) return fallback;
  // A clear majority wins; ties fall back.
  if (f > m) return "female";
  if (m > f) return "male";
  return fallback;
}

// The narrator voice for each gender (free edge-tts).
export function voiceForGender(gender, cfg) {
  if (gender === "male") return process.env.CF_MALE_VOICE || cfg.maleVoice || "en-US-BrianNeural";
  return process.env.CF_FEMALE_VOICE || cfg.femaleVoice || "en-US-JennyNeural";
}

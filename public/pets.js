// Shift+ pets: original, hand-built SVG critters that grow with your level.
// Stages: egg -> baby (Hatchling) -> kid (Buddy) -> hero (Legend). Moods: ecstatic, happy, sleepy.

let uid = 0;

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, v));
  const r = c((n >> 16) + amt), g = c(((n >> 8) & 255) + amt), b = c((n & 255) + amt);
  return `#${((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1)}`;
}

function egg(color, mood, id) {
  const dark = shade(color, -40);
  const sleepy = mood === "sleepy";
  return `
    <g class="pet-egg">
      <ellipse cx="60" cy="108" rx="26" ry="5" fill="#2B2040" opacity=".08"/>
      <path d="M60 18 C 84 18 94 58 94 76 C 94 96 79 106 60 106 C 41 106 26 96 26 76 C 26 58 36 18 60 18 Z" fill="#FFF6E0" stroke="${dark}" stroke-width="3"/>
      <circle cx="44" cy="52" r="6" fill="${color}" opacity=".7"/>
      <circle cx="76" cy="44" r="4.5" fill="${color}" opacity=".7"/>
      <circle cx="74" cy="88" r="7" fill="${color}" opacity=".7"/>
      <path d="M34 70 l8 -6 l7 7 l8 -7 l7 7 l8 -7 l7 6" fill="none" stroke="${dark}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${sleepy
        ? `<path d="M48 82 q4 3 8 0 M64 82 q4 3 8 0" stroke="#2B2040" stroke-width="2.5" fill="none" stroke-linecap="round"/>`
        : `<g class="pet-eyes"><circle cx="52" cy="82" r="3.6" fill="#2B2040"/><circle cx="68" cy="82" r="3.6" fill="#2B2040"/></g>`}
    </g>`;
}

function features(species, color, dark, light) {
  switch (species) {
    case "bunny":
      return {
        back: `<ellipse cx="44" cy="24" rx="9" ry="22" fill="${color}" transform="rotate(-10 44 40)"/>
               <ellipse cx="76" cy="24" rx="9" ry="22" fill="${color}" transform="rotate(10 76 40)"/>
               <ellipse cx="44" cy="26" rx="4" ry="15" fill="${light}" transform="rotate(-10 44 40)"/>
               <ellipse cx="76" cy="26" rx="4" ry="15" fill="${light}" transform="rotate(10 76 40)"/>`,
        front: `<path d="M57 77 q3 3 6 0" stroke="${dark}" stroke-width="2" fill="none" stroke-linecap="round"/>`,
      };
    case "fox":
      return {
        back: `<path d="M98 92 q18 -4 14 -26 q-8 10 -20 12 z" fill="${color}"/><path d="M112 66 q-2 8 -8 12 l4 4 q8 -6 4 -16z" fill="#FFF6E0"/>
               <path d="M30 46 L36 16 L54 36 Z" fill="${color}"/><path d="M90 46 L84 16 L66 36 Z" fill="${color}"/>
               <path d="M36 40 L38 24 L48 36 Z" fill="${dark}"/><path d="M84 40 L82 24 L72 36 Z" fill="${dark}"/>`,
        front: `<ellipse cx="60" cy="82" rx="16" ry="10" fill="#FFF6E0"/><circle cx="60" cy="76" r="3" fill="#2B2040"/>`,
      };
    case "cat":
      return {
        back: `<path d="M32 48 L34 18 L56 36 Z" fill="${color}"/><path d="M88 48 L86 18 L64 36 Z" fill="${color}"/>
               <path d="M37 40 L38 26 L48 35 Z" fill="${light}"/><path d="M83 40 L82 26 L72 35 Z" fill="${light}"/>`,
        front: `<path d="M57 76 l3 3 l3 -3 z" fill="${dark}"/>
                <path d="M30 74 h12 M30 80 l12 -2 M90 74 h-12 M90 80 l-12 -2" stroke="${dark}" stroke-width="1.6" stroke-linecap="round"/>`,
      };
    case "dino":
      return {
        back: `<path d="M40 34 l6 -14 l6 12 l6 -15 l6 15 l6 -12 l6 14" fill="${dark}"/>
               <path d="M96 90 q20 2 22 -14 q-8 6 -22 4 z" fill="${color}"/>`,
        front: `<circle cx="44" cy="92" r="4" fill="${dark}" opacity=".35"/><circle cx="78" cy="96" r="3" fill="${dark}" opacity=".35"/>
                <circle cx="56" cy="74" r="1.6" fill="${dark}"/><circle cx="64" cy="74" r="1.6" fill="${dark}"/>`,
      };
    case "axolotl":
      return {
        back: `<g fill="${dark}">
                 <path d="M26 50 q-16 -6 -18 -16 q12 2 20 10z"/><path d="M24 62 q-18 0 -22 -8 q14 -2 22 4z"/><path d="M26 74 q-16 6 -22 0 q12 -6 22 -6z"/>
                 <path d="M94 50 q16 -6 18 -16 q-12 2 -20 10z"/><path d="M96 62 q18 0 22 -8 q-14 -2 -22 4z"/><path d="M94 74 q16 6 22 0 q-12 -6 -22 -6z"/>
               </g>`,
        front: ``,
      };
    case "frog":
    default:
      return {
        back: `<circle cx="42" cy="36" r="15" fill="${color}"/><circle cx="78" cy="36" r="15" fill="${color}"/>`,
        front: ``,
        frogEyes: true,
      };
  }
}

/**
 * Returns SVG markup for a pet.
 * @param {{species:string,color:string,name?:string}} pet
 * @param {string} stage egg|baby|kid|hero
 * @param {string} mood ecstatic|happy|sleepy
 */
export function petSvg(pet, stage = "baby", mood = "happy", size = 120) {
  const id = `p${++uid}`;
  const color = pet?.color ?? "#9B5DE5";
  const dark = shade(color, -45);
  const light = shade(color, 70);
  const cls = `pet pet-${stage} mood-${mood}`;
  if (stage === "egg") {
    return `<svg class="${cls}" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${pet?.name ?? "Pet"} egg">${egg(color, mood, id)}</svg>`;
  }
  const scale = stage === "baby" ? 0.78 : stage === "kid" ? 0.92 : 1;
  const f = features(pet?.species, color, dark, light);
  const eyeY = f.frogEyes ? 36 : 64;
  const eyeL = 46, eyeR = 74;
  const sleepy = mood === "sleepy";
  const eyes = sleepy
    ? `<path d="M${eyeL - 6} ${eyeY} q6 5 12 0 M${eyeR - 6} ${eyeY} q6 5 12 0" stroke="#2B2040" stroke-width="3" fill="none" stroke-linecap="round"/>`
    : `<g class="pet-eyes">
         <ellipse cx="${eyeL}" cy="${eyeY}" rx="7.5" ry="8.5" fill="#fff"/><ellipse cx="${eyeR}" cy="${eyeY}" rx="7.5" ry="8.5" fill="#fff"/>
         <circle cx="${eyeL + 1}" cy="${eyeY + 1}" r="5" fill="#2B2040"/><circle cx="${eyeR + 1}" cy="${eyeY + 1}" r="5" fill="#2B2040"/>
         <circle cx="${eyeL + 3}" cy="${eyeY - 2}" r="1.8" fill="#fff"/><circle cx="${eyeR + 3}" cy="${eyeY - 2}" r="1.8" fill="#fff"/>
       </g>`;
  const mouthY = f.frogEyes ? 70 : 82;
  const mouth =
    mood === "ecstatic"
      ? `<path d="M50 ${mouthY} q10 14 20 0 z" fill="#2B2040"/><path d="M55 ${mouthY + 5} q5 5 10 0" fill="#FF6B8B"/>`
      : sleepy
        ? `<ellipse cx="60" cy="${mouthY + 2}" rx="3" ry="2.4" fill="#2B2040"/>`
        : `<path d="M51 ${mouthY} q9 9 18 0" stroke="#2B2040" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const extras =
    stage === "kid"
      ? `<path d="M34 92 q26 12 52 0 l-4 8 q-22 9 -44 0 z" fill="#FFC83D"/><circle cx="76" cy="98" r="3" fill="#FF5FA2"/>`
      : stage === "hero"
        ? `<g class="pet-crown"><path d="M44 22 l6 -14 l10 10 l10 -10 l6 14 z" fill="#FFC83D" stroke="#E0A100" stroke-width="2" stroke-linejoin="round"/>
             <circle cx="60" cy="13" r="3" fill="#FF5FA2"/></g>`
        : "";
  const zzz = sleepy ? `<text class="pet-zzz" x="92" y="30" font-size="16" font-weight="700" fill="${dark}">z</text>` : "";
  const sparkles =
    mood === "ecstatic"
      ? `<g class="pet-sparkles" fill="#FFC83D"><path d="M14 30 l3 7 l7 3 l-7 3 l-3 7 l-3 -7 l-7 -3 l7 -3z"/><path d="M104 22 l2 5 l5 2 l-5 2 l-2 5 l-2 -5 l-5 -2 l5 -2z"/></g>`
      : "";
  return `<svg class="${cls}" viewBox="0 0 120 120" width="${size}" height="${size}" role="img" aria-label="${pet?.name ?? "Pet"}">
    <ellipse cx="60" cy="112" rx="${30 * scale}" ry="5" fill="#2B2040" opacity=".08" class="pet-shadow"/>
    ${sparkles}
    <g class="pet-body" transform="translate(${60 - 60 * scale} ${118 - 118 * scale}) scale(${scale})">
      ${f.back}
      <path d="M60 30 C 90 30 100 58 100 78 C 100 100 82 110 60 110 C 38 110 20 100 20 78 C 20 58 30 30 60 30 Z" fill="${color}"/>
      <ellipse cx="60" cy="92" rx="24" ry="15" fill="${light}" opacity=".85"/>
      <ellipse cx="30" cy="104" rx="10" ry="6" fill="${dark}"/><ellipse cx="90" cy="104" rx="10" ry="6" fill="${dark}"/>
      ${f.frogEyes ? "" : ""}
      ${eyes}
      <ellipse cx="${eyeL - 8}" cy="${mouthY - 4}" rx="6" ry="3.5" fill="#FF8FAB" opacity=".7"/>
      <ellipse cx="${eyeR + 8}" cy="${mouthY - 4}" rx="6" ry="3.5" fill="#FF8FAB" opacity=".7"/>
      ${f.front}
      ${mouth}
      ${extras}
    </g>
    ${zzz}
  </svg>`;
}

export const STAGE_LABEL = { egg: "Egg", baby: "Hatchling", kid: "Buddy", hero: "Legend" };

export function moodLine(name, mood) {
  if (mood === "ecstatic") return `${name} is bouncing with joy!`;
  if (mood === "sleepy") return `${name} is napping. Earn some XP to wake them up.`;
  return `${name} is happy to see you.`;
}

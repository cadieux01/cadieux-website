// Emoji palette for the admin row-reaction picker.
//
// GENERATED FILE — do not edit by hand. Regenerate with:
//   node scripts/generate-emoji-data.js
//
// Contains every assigned code point in Node's Unicode tables carrying the
// Emoji_Presentation property: 1219 of them, deduplicated across groups,
// with a final sweep into "More" so nothing is silently dropped.
//
// WHY THAT PROPERTY, and not Extended_Pictographic, which sounds more
// complete: Extended_Pictographic deliberately covers RESERVED ranges set
// aside for emoji Unicode has not assigned yet. Enumerating it renders a
// grid peppered with tofu boxes, and which cells are boxes differs per OS
// and per OS version. Emoji_Presentation is assigned-only and defaults to
// colour presentation, so every cell here draws as an emoji on its own,
// without a variation selector.
//
// Consequently NOT included: characters that need U+FE0F to become emoji
// (heart, sun, aeroplane) and multi-code-point ZWJ sequences (family). The
// frequently-wanted ones are in PINNED_EMOJI, which is a quick-access row
// and NOT a cap — the full grid sits directly underneath it.
//
// Each group is one packed string rather than an array of strings: same
// characters, roughly a third of the bytes, unpacked surrogate-safely by
// splitByCodePoint(). The picker imports this module lazily, so none of it
// reaches the boards' initial bundle.

/** Quick-access row above the full grid. A shortcut, never the limit. */
export const PINNED_EMOJI: readonly string[] = [
  "\u{1F44D}", // thumbs up - acknowledged
  "\u{1F44E}", // thumbs down
  "\u{2705}", // check - done
  "\u{274C}", // cross - problem
  "\u{1F525}", // fire - urgent
  "\u{1F440}", // eyes - looking into it
  "\u{1F4DE}", // telephone - call them
  "\u{1F4B0}", // money bag - payment issue
  "\u{1F6A9}", // flag - flagged
  "\u{2753}", // question - unclear
  "\u{1F389}", // party popper - good news
  "\u{1F614}", // pensive - bad news
];

export type EmojiGroup = {
  name: string;
  /** Packed. Unpack with splitByCodePoint(). */
  emoji: string;
};

export const EMOJI_GROUPS: readonly EmojiGroup[] = [
  { name: "Smileys & Emotion", emoji: "😀😁😂😃😄😅😆😇😈😉😊😋😌😍😎😏😐😑😒😓😔😕😖😗😘😙😚😛😜😝😞😟😠😡😢😣😤😥😦😧😨😩😪😫😬😭😮😯😰😱😲😳😴😵😶😷😸😹😺😻😼😽😾😿🙀🙁🙂🙃🙄🙅🙆🙇🙈🙉🙊🙋🙌🙍🙎🙏🥰🥱🥲🥳🥴🥵🥶🥷🥸🥹🥺" },
  { name: "People & Body", emoji: "👀👂👃👄👅👆👇👈👉👊👋👌👍👎👏👐👤👥👦👧👨👩👪👫👬👭👮👯👰👱👲👳👴👵👶👷👸👹👺👻👼👽👾👿💀💁💂💃💄💅💆💇🕺🖕🖖🤌🤍🤎🤏🤐🤑🤒🤓🤔🤕🤖🤗🤘🤙🤚🤛🤜🤝🤞🤟🤠🤡🤢🤣🤤🤥🤦🤧🤨🤩🤪🤫🤬🤭🤮🤯🤰🤱🤲🤳🤴🤵🤶🤷🤸🤹🤺🤼🤽🤾🦰🦱🦲🦳🦴🦵🦶🦷🦸🦹🦺🦻🦼🦽🦾🦿🧀🧁🧂🧃🧄🧅🧆🧇🧈🧉🧊🧋🧌🧍🧎🧏🧐🧑🧒🧓🧔🧕🧖🧗🧘🧙🧚🧛🧜🧝🧞🧟🫀🫁🫂🫃🫄🫅🫰🫱🫲🫳🫴🫵🫶🫷🫸" },
  { name: "Animals & Nature", emoji: "🐀🐁🐂🐃🐄🐅🐆🐇🐈🐉🐊🐋🐌🐍🐎🐏🐐🐑🐒🐓🐔🐕🐖🐗🐘🐙🐚🐛🐜🐝🐞🐟🐠🐡🐢🐣🐤🐥🐦🐧🐨🐩🐪🐫🐬🐭🐮🐯🐰🐱🐲🐳🐴🐵🐶🐷🐸🐹🐺🐻🐼🐽🐾🦀🦁🦂🦃🦄🦅🦆🦇🦈🦉🦊🦋🦌🦍🦎🦏🦐🦑🦒🦓🦔🦕🦖🦗🦘🦙🦚🦛🦜🦝🦞🦟🦠🦡🦢🦣🦤🦥🦦🦧🦨🦩🦪🦫🦬🦭🦮🌰🌱🌲🌳🌴🌵🌷🌸🌹🌺🌻🌼🌽🌾🌿🍀🍁🍂🍃🎄🎅🎆🎇🎈🎉🎊🎋🎌🎍🎎🎏🪰🪱🪲🪳🪴🪵🪶🪷🪸🪹🪺🪻🪼🪽🪾🪿" },
  { name: "Food & Drink", emoji: "🍄🍅🍆🍇🍈🍉🍊🍋🍌🍍🍎🍏🍐🍑🍒🍓🍔🍕🍖🍗🍘🍙🍚🍛🍜🍝🍞🍟🍠🍡🍢🍣🍤🍥🍦🍧🍨🍩🍪🍫🍬🍭🍮🍯🍰🍱🍲🍳🍴🍵🍶🍷🍸🍹🍺🍻🍼🍾🍿🥂🥃🥄🥅🥇🥈🥉🥊🥋🥌🥍🥎🥏🥐🥑🥒🥓🥔🥕🥖🥗🥘🥙🥚🥛🥜🥝🥞🥟🥠🥡🥢🥣🥤🥥🥦🥧🥨🥩🥪🥫🥬🥭🥮🥯🫐🫑🫒🫓🫔🫕🫖🫗🫘🫙🫚🫛🫜🫟" },
  { name: "Travel & Places", emoji: "🚀🚁🚂🚃🚄🚅🚆🚇🚈🚉🚊🚋🚌🚍🚎🚏🚐🚑🚒🚓🚔🚕🚖🚗🚘🚙🚚🚛🚜🚝🚞🚟🚠🚡🚢🚣🚤🚥🚦🚧🚨🚩🚪🚫🚬🚭🚮🚯🚰🚱🚲🚳🚴🚵🚶🚷🚸🚹🚺🚻🚼🚽🚾🚿🛀🛁🛂🛃🛄🛅🛌🛐🛑🛒🛕🛖🛗🛘🛜🛝🛞🛟🛫🛬🛴🛵🛶🛷🛸🛹🛺🛻🛼🏠🏡🏢🏣🏤🏥🏦🏧🏨🏩🏪🏫🏬🏭🏮🏯🏰🌍🌎🌏🌐🌑🌒🌓🌔🌕🌖🌗🌘🌙🌚🌛🌜🌝🌞🌟🌠" },
  { name: "Activities", emoji: "🎠🎡🎢🎣🎤🎥🎦🎧🎨🎩🎪🎫🎬🎭🎮🎯🎰🎱🎲🎳🎴🎵🎶🎷🎸🎹🎺🎻🎼🎽🎾🎿🏀🏁🏂🏃🏄🏅🏆🏇🏈🏉🏊🏏🤿" },
  { name: "Objects", emoji: "💠💡💢💣💤💥💦💧💨💩💪💫💬💭💮💯💰💱💲💳💴💵💶💷💸💹💺💻💼💽💾💿📀📁📂📃📄📅📆📇📈📉📊📋📌📍📎📏📐📑📒📓📔📕📖📗📘📙📚📛📜📝📞📟📠📡📢📣📤📥📦📧📨📩📪📫📬📭📮📯📰📱📲📳📴📵📶📷📸📹📺📻📼📿🔊🔋🔌🔍🔎🔏🔐🔑🔒🔓🔔🔕🔖🔗🔘🔙🔚🔛🔜🔝🔞🔟🔠🔡🔢🔣🔤🔥🔦🔧🔨🔩🔪🔫🔬🔭🔮🔯🔰🔱🔲🔳🔴🔵🔶🔷🔸🔹🔺🔻🔼🔽🩰🩱🩲🩳🩴🩵🩶🩷🩸🩹🩺🩻🩼🪀🪁🪂🪃🪄🪅🪆🪇🪈🪉🪊🪎🪏🪐🪑🪒🪓🪔🪕🪖🪗🪘🪙🪚🪛🪜🪝🪞🪟🪠🪡🪢🪣🪤🪥🪦🪧🪨🪩🪪🪫🪬🪭🪮🪯" },
  { name: "Symbols", emoji: "⌚⌛⏩⏪⏫⏬⏰⏳◽◾☔☕♈♉♊♋♌♍♎♏♐♑♒♓♿⚓⚡⚪⚫⚽⚾⛄⛅⛎⛔⛪⛲⛳⛵⛺⛽✅✊✋✨❌❎❓❔❕❗➕➖➗➰➿⬛⬜⭐⭕🆑🆒🆓🆔🆕🆖🆗🆘🆙🆚🔀🔁🔂🔃🔄🔅🔆🔇🔈🔉🕋🕌🕍🕎" },
  { name: "More", emoji: "🀄🃏🆎🇦🇧🇨🇩🇪🇫🇬🇭🇮🇯🇰🇱🇲🇳🇴🇵🇶🇷🇸🇹🇺🇻🇼🇽🇾🇿🈁🈚🈯🈲🈳🈴🈵🈶🈸🈹🈺🉐🉑🌀🌁🌂🌃🌄🌅🌆🌇🌈🌉🌊🌋🌌🌭🌮🌯🎀🎁🎂🎃🎐🎑🎒🎓🏐🏑🏒🏓🏴🏸🏹🏺🏻🏼🏽🏾🏿👑👒👓👔👕👖👗👘👙👚👛👜👝👞👟👠👡👢👣💈💉💊💋💌💍💎💏💐💑💒💓💔💕💖💗💘💙💚💛💜💝💞💟🕐🕑🕒🕓🕔🕕🕖🕗🕘🕙🕚🕛🕜🕝🕞🕟🕠🕡🕢🕣🕤🕥🕦🕧🖤🗻🗼🗽🗾🗿🟠🟡🟢🟣🟤🟥🟦🟧🟨🟩🟪🟫🟰🥀🥁🥻🥼🥽🥾🥿🦯🧠🧡🧢🧣🧤🧥🧦🧧🧨🧩🧪🧫🧬🧭🧮🧯🧰🧱🧲🧳🧴🧵🧶🧷🧸🧹🧺🧻🧼🧽🧾🧿🫆🫈🫍🫎🫏🫠🫡🫢🫣🫤🫥🫦🫧🫨🫩🫪🫯" },
];

/**
 * Split a packed group into individual emoji.
 *
 * Array.from, not split(""), because these characters are astral:
 * split would hand back lone surrogate halves and the grid would render
 * mojibake instead of emoji.
 */
export function splitByCodePoint(packed: string): string[] {
  return Array.from(packed);
}

/** Palette size, for the count in the picker footer. */
export const EMOJI_COUNT = 1219;

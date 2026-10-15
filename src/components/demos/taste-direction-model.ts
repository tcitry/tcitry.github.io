/**
 * Derived from Leonxlnx/taste-skill, commit f624f37a8c650b9cc550253104925efe4c8de246.
 * library/directions.json + scripts/draw.mjs. Metadata only; no site assets.
 * MIT License
 *
 * Copyright (c) 2026 Leonxlnx
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 */
export const TASTE_COMMIT = 'f624f37a8c650b9cc550253104925efe4c8de246';
export interface Direction {
  id: string; name: string; sectors: string[]; tones: string[]; needs: string[];
  needsPictures?: boolean; idea: string; composition: string;
}
export const DIRECTIONS: readonly Direction[] = [
  {
    "id": "name-as-monument",
    "name": "The name as a monument",
    "sectors": [
      "agency",
      "studio-portfolio",
      "personal-portfolio",
      "hospitality",
      "restaurant",
      "music",
      "culture",
      "fashion",
      "event",
      "architecture",
      "real-estate",
      "physical-product",
      "consumer-app",
      "other"
    ],
    "tones": [
      "bold",
      "editorial",
      "luxury"
    ],
    "needs": [],
    "idea": "The name is the headline. Set it so large that it becomes architecture: as wide as the viewport, cropped by an edge, or stacked to fill the screen. Nothing else on the first screen competes; the description of what this is drops to a single small sentence. The idea comes from treating the name's letters as material. Ask what the subject can do to its own name: a photograph of the work sits inside a counter or replaces a letter, the name repeats down the page like a reel, the letters are split to opposite corners and the page happens between them. In the study this was the single most common device among sites scoring 7.5 or more.",
    "composition": "First screen: the wordmark spans 88–100% of the viewport width (font-size 16–24vw, set with a clamp so it never wraps), anchored either to the bottom edge with its descenders nearly touching it, or dead centre with everything else pushed to the corners. One line of supporting text at 16–20px sits in a corner on a shared margin; navigation is three or four words in the opposite corner. After the hero the page is deliberately small and calm: a narrow text column or a simple two-column grid, so the contrast with the monument holds. The name returns once more at full width as the footer, in the inverse colours. Margins are tight (20–32px) so the type reaches the edges. Two type sizes do nearly all the work: the monument and a small text size, with one mid size for section headings."
  },
  {
    "id": "sentence-as-layout",
    "name": "The sentence is the layout",
    "sectors": [
      "agency",
      "saas",
      "ai-product",
      "dev-tool",
      "nonprofit",
      "culture",
      "education",
      "physical-product",
      "consumer-app",
      "finance",
      "health",
      "event",
      "other"
    ],
    "tones": [
      "bold",
      "editorial"
    ],
    "needs": [],
    "idea": "One short sentence, set at poster scale, is the composition. The trick that makes it an idea rather than a big headline: something from the subject sits inside the sentence where a word would be. A strip of photograph fills the gap between two words; a small live fragment of the product replaces the noun; the object the sentence names is pictured at the size of a letter. Write the sentence first, find the word that can be shown instead of said, and put the showing in its place. The reader completes the sentence with their eyes.",
    "composition": "The sentence is four to seven words and runs as one or two full-width lines at 9–13vw. Inline with the type, on the baseline, sits one media slot: a rounded-rectangle or square frame exactly one line-height tall and two to three ems wide, holding a photograph or a looping crop. Above and below the sentence the screen is empty except for a small navigation line and one supporting sentence set small, both on the same left margin. Later sections repeat the grammar at smaller scale: each is a short statement on the left six columns with its proof (image, figure, list) on the right, so the page reads as a series of sentences with evidence. Generous vertical space (160px or more) between sections."
  },
  {
    "id": "pinned-poster",
    "name": "The pinned poster",
    "sectors": [
      "culture",
      "music",
      "event",
      "fashion",
      "personal-portfolio",
      "studio-portfolio",
      "physical-product",
      "ecommerce",
      "hospitality",
      "consumer-app"
    ],
    "tones": [
      "bold",
      "editorial"
    ],
    "needs": [],
    "needsPictures": true,
    "idea": "Something stays put while everything else changes. A title holds its place across the viewport and the images beneath it swap; the name is split to two opposite corners and the page passes between the halves; a single frame stays centred while its contents change. Every scroll step is a new cover of the same magazine. The idea suits subjects that are a series (a book of portraits, a line-up, a collection, a set of projects): the fixed element says what the series is, the changing element shows its members.",
    "composition": "A sticky layer holds the fixed element for the height of two to three viewports: usually the title at 10–14vw across the middle or top of the screen, or two words pinned to the top-left and bottom-right corners. Under it, a stack of full-height panels scrolls by, each a single large photograph (portrait 4:5, centred, 40–50% of the viewport wide) with one line of caption at the same small size everywhere. The title sits above the images in the stacking order and uses `mix-blend-mode: difference` or a solid colour that reads on every panel. When the pinned run ends, the page releases into ordinary flowing sections with a narrow measure. Build with `position: sticky`; never hijack the scroll."
  },
  {
    "id": "colour-chapters",
    "name": "Colour chapters",
    "sectors": [
      "agency",
      "music",
      "event",
      "education",
      "nonprofit",
      "saas",
      "consumer-app",
      "culture",
      "physical-product",
      "health",
      "finance",
      "ai-product"
    ],
    "tones": [
      "bold",
      "playful"
    ],
    "needs": [],
    "idea": "Every section is a chapter with its own flat colour, floor to ceiling. The page reads like a set of posters hung in a row, held together by one typeface and one grid. The colours are not decoration: they come from the subject (the brand's packaging, the artist's record sleeves, the product's own colour ways, the categories of the content) and each chapter's colour means that chapter. Decide the sequence like a designer orders a book: a strong opener, a quiet second, a surprise in the middle, a dark or very light closer.",
    "composition": "Sections are full-bleed fields, each at least 90svh tall, butted directly against each other with no gap and no divider. Inside every field the same 12-column grid and the same margins apply, and each field holds one thing: a huge heading (8–12vw) with a small paragraph, or one photograph with a caption, or one list. Text colour is chosen per field for strong contrast (ink or paper, never grey). Headings start on the same left edge in every chapter, so the eye feels the system as colours change. The navigation and the footer take the colours of the first and last chapter."
  },
  {
    "id": "place-carries-it",
    "name": "The place carries it",
    "sectors": [
      "hospitality",
      "restaurant",
      "real-estate",
      "architecture",
      "event",
      "health",
      "culture",
      "nonprofit"
    ],
    "tones": [
      "quiet",
      "luxury",
      "warm"
    ],
    "needs": [],
    "needsPictures": true,
    "idea": "For a place, the photograph is the argument. One full-bleed image of where you would be standing fills the first screen, and the design steps back: the name sits along the bottom edge like a film title, or small in a corner, and nothing else interrupts the view. The page that follows keeps that restraint: few words, large pictures, long pauses. The designer's work here is editing: choosing the one frame that makes someone want to be there, and then not covering it.",
    "composition": "First screen: a single photograph at 100vw by 100svh, focal point kept clear of text. The name is set either very large (14–20vw) hugging the bottom edge with 16–24px of margin, or small (20–28px) top-left with a one-line description bottom-left. Navigation is two to four words in the top corners in the same small size. If text sits on the image, a soft neutral scrim under the text area only. Below, sections alternate between a short centred or left-set paragraph in a narrow column (max 52ch) with wide empty margins, and photographs shown large: one full-bleed, then a pair at different sizes, then one portrait offset to the right. Practical information (hours, address, rates, booking) is gathered once near the end in a plain two-column block."
  },
  {
    "id": "page-is-the-object",
    "name": "The page is the object",
    "sectors": [
      "restaurant",
      "event",
      "hospitality",
      "culture",
      "music",
      "physical-product",
      "ecommerce",
      "nonprofit",
      "education",
      "personal-portfolio",
      "consumer-app",
      "other"
    ],
    "tones": [
      "warm",
      "playful",
      "editorial"
    ],
    "needs": [],
    "idea": "Find the printed or physical artefact that already exists in the subject's world and build the page as that thing. A wedding site is the invitation card. A restaurant is its menu. A conference is the ticket; a record is its sleeve; a shop is the receipt or the swing tag; an archive is a stack of tabbed folders; a course is the syllabus sheet. The artefact supplies everything a template would otherwise invent: its proportions, its typographic manners, its way of grouping information. Visitors recognise the object instantly, which is why these pages feel specific.",
    "composition": "The first screen shows the artefact as a single filled panel (paper colour on a contrasting ground) centred or offset, with believable proportions: a card at 5:7, a ticket at about 2.2:1 with a notch cut by `clip-path`, a menu as a tall sheet. All primary content lives on it, set the way that object is set: centred and symmetrical for an invitation, in tidy aligned columns for a menu or ticket. The ground behind is a flat colour or one full-bleed photograph. As the page continues, each section is another piece of the same stationery: a second card, a tear-off stub, a folded panel, always filled shapes with real edges (straight, notched, scalloped, perforated by a dotted `border` of round dots at 4px or more), never outlined boxes. The footer is the back of the object."
  },
  {
    "id": "one-motif",
    "name": "One motif",
    "sectors": [
      "saas",
      "finance",
      "consumer-app",
      "ai-product",
      "dev-tool",
      "health",
      "physical-product",
      "restaurant",
      "education",
      "nonprofit",
      "other"
    ],
    "tones": [
      "playful",
      "technical",
      "warm",
      "bold"
    ],
    "needs": [],
    "idea": "Take one shape from the subject and let it run the whole system. A drilling tool's octagonal cross-section becomes the buttons, the image masks and the loader. A two-account money app becomes two circles that recur as icon, inline dot and section colour. A café's striped awning becomes every band on the page. Look at the product, the logo, the object or the word in the headline and find the simplest geometry in it (a circle, an arc, a chamfer, a stripe, a notch, a ring). Then use only that shape, at three or four very different scales, everywhere a designer would normally reach for a generic rounded rectangle.",
    "composition": "Hero: the motif appears once at enormous scale as a flat filled shape, cropped by the viewport (a circle 120vh across entering from the right, a chamfered block filling the lower half), with a short headline at 6–8vw and one supporting sentence set on the remaining ground, left-aligned on a shared margin. Through the page the motif returns as: the mask for every photograph (via `clip-path` or `border-radius` made from the same geometry), the shape of the primary button, the bullet beside list items at text size, and one full-width band that separates the two halves of the page. Sections use simple two-column or single-column layouts so the shape is the only thing with character."
  },
  {
    "id": "product-performs",
    "name": "The product performs",
    "sectors": [
      "saas",
      "dev-tool",
      "ai-product",
      "consumer-app",
      "finance"
    ],
    "tones": [
      "technical",
      "quiet"
    ],
    "needs": [],
    "idea": "Software is most convincing when it is doing its job in front of you. Instead of describing features, put small, true, working fragments of the product on the page: the actual control, with real content, responding to the pointer. A colour picker's loupe reads the page's own background and prints its value. A list tool lets you tick an item right there. A type-scale plugin sets the page's own headings. Find the one interaction that is the product and make the hero that interaction; then show each further capability as another fragment at real size. No dashboard collage, no browser frame, no screenshots shrunk until unreadable.",
    "composition": "Hero: a short plain headline (4–6vw, left-aligned, upper-left third) and one sentence; the rest of the first screen is the main fragment at actual interface size, sitting directly on the page or on one flat stage colour, large enough to read every label. The fragment is built in HTML and works. Below, capabilities are a single-column sequence, each a row of two parts on a 5/7 split: a two-line statement on one side and the relevant fragment on the other, with the fragments varying in size and shape so the column never becomes a zigzag of equal blocks. Fragments are cropped pieces of interface (a menu, a row, a control, a panel edge), not whole windows. One section pins a fragment while three short statements change it."
  },
  {
    "id": "quiet-instrument",
    "name": "The quiet instrument",
    "sectors": [
      "saas",
      "dev-tool",
      "ai-product",
      "personal-portfolio",
      "consumer-app",
      "finance",
      "other"
    ],
    "tones": [
      "quiet",
      "technical"
    ],
    "needs": [],
    "idea": "Radical understatement. Where every competitor shouts, this page almost whispers: a headline barely larger than body text, a narrow column, small exact demonstrations, and a great deal of untouched space. The restraint is the claim. It says the thing is simple, finished and sure of itself. This only works when it is carried through completely; one loud element breaks it. In the study, a tool for simple lists sold itself with a 27px headline and 12–14px copy and was one of the most confident pages in the set.",
    "composition": "A single column 440–560px wide, placed left of centre (starting at about 22% of the viewport width) or dead centre, running the whole page. The headline is the one large thing on the first screen: two lines at display size (5–7vw), medium weight, starting on the column's left edge and allowed to run wider than the column. The supporting paragraph follows at body size (17–19px) in the full ink. One small primary button and one text link. Below, each point is a short paragraph followed by a compact demonstration or image no wider than the column. Sections are separated only by space (96–140px). Nothing spans the full width until the footer, which is a single quiet line. The first screen is mostly empty and that emptiness is composed: the column's top edge sits at about 30% of the viewport height."
  },
  {
    "id": "hero-object",
    "name": "The object, large",
    "sectors": [
      "physical-product",
      "ecommerce",
      "consumer-app",
      "fashion",
      "finance",
      "health",
      "restaurant",
      "music"
    ],
    "tones": [
      "bold",
      "luxury",
      "quiet"
    ],
    "needs": [
      "product-photo"
    ],
    "idea": "Show the thing, bigger than seems reasonable. One photographed object fills the first screen, scaled until the viewport crops it, with the text small and tucked beside or behind it. The crop is the idea: a record whose edge leaves the top-right corner, a bottle whose shoulder runs off the bottom, a chair seen so close you read its grain. Being that close reads as confidence in the object. Everything else on the page serves it: details as tight close-ups, facts as short lines, one way to buy.",
    "composition": "First screen: the object occupies 55–75% of the viewport and breaks at least one edge. It sits on a flat field (ground colour or one bold colour), never in a box. The headline is short and either very large and partly hidden behind the object (10–13vw, the object overlapping two or three letters) or small (28–36px) in the opposite corner with a one-line description. No navigation bar beyond a wordmark and one action. Following sections: a row of three or four close-up details at different crop ratios (not equal tiles), a single wide photograph of the object in use, a plain list of facts set large (materials, size, price) aligned to one edge, then the purchase action. The object returns once at the end from a different angle."
  },
  {
    "id": "specimen-catalogue",
    "name": "The specimen catalogue",
    "sectors": [
      "ecommerce",
      "physical-product",
      "restaurant",
      "fashion",
      "culture",
      "education",
      "health",
      "other"
    ],
    "tones": [
      "playful",
      "warm",
      "editorial"
    ],
    "needs": [
      "product-photo"
    ],
    "idea": "Present what is on offer the way a field guide presents birds: each item alone on a flat colour, same scale, same angle, named plainly. A bakery's pastries become specimens and the specimens become the menu. A furniture maker's chairs each get their own colour tile. The format flatters ordinary objects because it treats each as worth looking at, and it replaces both the feature grid and the product-card grid with something that has a point of view.",
    "composition": "Hero: a left-aligned statement of what this is (5–7vw, upper-left) beside or above a tight cluster of four to seven specimen tiles of different sizes arranged as a loose mosaic that runs off the right edge. Each tile is a flat colour square or 4:5 rectangle with one photograph centred on it, no border, 8–12px gaps. The main section is the catalogue itself: a grid of tiles in which each item has its name and one fact set beneath the tile in the text face, aligned left to the tile edge. Tile colours rotate through three or four fields from the palette. One tile in every six or seven is double size. Supporting sections (about, how to order) are plain text on the ground colour, kept short."
  },
  {
    "id": "borrowed-category",
    "name": "Dressed as something else",
    "sectors": [
      "finance",
      "saas",
      "consumer-app",
      "physical-product",
      "health",
      "dev-tool",
      "ai-product",
      "education",
      "nonprofit",
      "real-estate",
      "other"
    ],
    "tones": [
      "bold",
      "playful",
      "luxury"
    ],
    "needs": [],
    "idea": "Art-direct the subject as if it belonged to a different, more vivid category. A money app is sold like a streetwear drop. An industrial roaster is presented like a design object. Drilling hardware gets the calm of a watch brand. A parcel-locker service becomes a fairground of stickers. Choose the borrowed category by asking what feeling the audience is missing from this kind of product (swagger, calm, glamour, play) and which category owns that feeling. Then take its manners completely: its type, its pacing, its way of photographing things. The contrast between dull subject and vivid dress is what people remember.",
    "composition": "Depends on the borrowed category, so decide it explicitly and write it in your notes. Fashion drop: one shouted condensed headline across the full width, a single cropped image under it, then product facts as a blunt list. Watch or perfume: a centred object on a dark field, a small serif name, very few words, long vertical pauses. Poster or zine: flat colour blocks, heavy type, tilted cut-out images. Museum: one item per screen on a plinth-like band of colour with a short label beside it. Whichever you choose, the page structure stays simple (four to six sections) and every section uses the borrowed manners, including pricing and the footer."
  },
  {
    "id": "contact-sheet",
    "name": "The contact sheet",
    "sectors": [
      "personal-portfolio",
      "studio-portfolio",
      "agency",
      "fashion",
      "culture",
      "architecture",
      "music",
      "ecommerce"
    ],
    "tones": [
      "quiet",
      "technical",
      "editorial"
    ],
    "needs": [],
    "needsPictures": true,
    "idea": "Show everything at once, small, in order. The work is laid out like a photographer's contact sheet or an archive drawer: dozens of small frames in strict rows, with all text set at one small size. Nothing is featured, which is the point: the volume and consistency of the body of work is the statement, and the visitor does the choosing. It suits people and studios whose strength is range and output.",
    "composition": "The name, or one sentence about the work, sits at display size (6–9vw) across the top of the first screen, and the sheet begins directly under it, still inside the first screen. The first screen opens with three or four short blocks of small text across the top on a 12-column grid (who, what, where to reach them), all at 14–16px, and immediately below, the sheet begins: rows of thumbnails at a fixed height (90–140px) with their natural widths, 6–10px gaps, each project forming a run of four to eight frames preceded by its title in the same small text. The sheet fills the whole page width edge to edge with 16–20px margins. Hovering a run dims the others and shows that project's one-line description in a fixed position. A single enlarged frame may interrupt the sheet once per screen at four times the size."
  },
  {
    "id": "editorial-report",
    "name": "The printed annual",
    "sectors": [
      "culture",
      "nonprofit",
      "education",
      "finance",
      "saas",
      "ai-product",
      "health",
      "agency",
      "other"
    ],
    "tones": [
      "editorial",
      "bold"
    ],
    "needs": [],
    "idea": "Lay the page out like a well-designed printed report or magazine feature: a masthead image, a tight oversized title, text held to a strict column line, and colour used in solid blocks the way a two-colour print job would. It gives weight and authority to subjects that are really about content: findings, a manifesto, a programme, a serious product. The reader should feel that someone edited this.",
    "composition": "A fixed vertical axis at about 42% of the viewport width organises everything: headings begin on it, body columns hang from it, and the 0–42% zone holds small side notes, figures or stays empty. Masthead: a wide image band (photographic mosaic or a single crop) across the top 45% of the first screen; below it the title at 7–9vw starting on the axis, with a two-sentence standfirst at 20–24px. Sections alternate between text pages (title on the axis, body in one or two columns of 34–40ch to its right) and full-bleed colour pages carrying one large figure, quotation or image mosaic. Mosaics are gutterless: photographs and flat colour tiles butted together in a 4- or 6-cell grid. Page numbers, running heads and other print furniture are left out."
  },
  {
    "id": "loud-flat-poster",
    "name": "Loud and flat",
    "sectors": [
      "agency",
      "consumer-app",
      "music",
      "event",
      "education",
      "nonprofit",
      "physical-product",
      "saas",
      "culture"
    ],
    "tones": [
      "bold",
      "playful"
    ],
    "needs": [],
    "idea": "A page with the directness of a street poster: flat saturated colour, the heaviest type you can find, short blunt statements, and photographs cut out and stuck on. It is for subjects with a voice. Write the page as things a person would actually say out loud, and let the design say them at full volume. The craft is in the control beneath the noise: a strict grid, two or three colours, and exact alignment keep it from becoming a mess.",
    "composition": "Hero: a statement of three to six words in ultra-heavy type at 11–15vw, filling the width, lines stacked tight (leading 0.85), flush left with 20–28px margins, on a flat saturated ground. One cut-out or hard-cropped photograph overlaps the type from the right or bottom, tilted 3–6 degrees. A single chunky button in the contrasting flat colour. Sections are solid panels in alternating palette colours: one is a row of short statements each on its own panel of unequal width; one is a single photograph bleeding off two edges with a caption block set over a solid colour bar; one is a large plain list. Panels meet edge to edge. Corners are square or use one large radius (28–40px) consistently."
  },
  {
    "id": "split-stage",
    "name": "The split stage",
    "sectors": [
      "restaurant",
      "hospitality",
      "personal-portfolio",
      "physical-product",
      "fashion",
      "real-estate",
      "health",
      "culture",
      "ecommerce",
      "saas",
      "consumer-app"
    ],
    "tones": [
      "warm",
      "quiet",
      "editorial"
    ],
    "needs": [],
    "idea": "Half the screen never moves. One side is a fixed photograph (or object, or product view) that stays in place for the whole visit; the other side is a calm scrolling column with everything you need to read. The fixed half keeps the feeling present while the reader gets on with the facts, like sitting in the room while reading the menu. As sections pass, the fixed image may quietly change to the one that matches.",
    "composition": "Desktop: a two-column page, 50/50 or 45/55. One column is `position: sticky; top: 0; height: 100svh` and holds a single photograph filling it edge to edge, or the object centred on a flat field. The other column scrolls and holds all content in a single narrow measure (max 46ch) with comfortable padding (48–72px): name and one-line description first, then sections separated by generous space, then contact and footer. Headings in the scrolling column are modest (32–44px). The column grounds differ: photograph on one side, flat paper colour on the other, meeting at a clean vertical edge. On a phone the fixed half becomes a 60svh image at the top that stays sticky behind the first section, then releases."
  },
  {
    "id": "dense-tiles",
    "name": "The well-kept board",
    "sectors": [
      "agency",
      "studio-portfolio",
      "saas",
      "dev-tool",
      "ai-product",
      "culture",
      "music",
      "other"
    ],
    "tones": [
      "technical",
      "bold"
    ],
    "needs": [],
    "idea": "The whole page is a board of tiles fitted edge to edge with narrow gaps, like a tidy desk seen from above. Each tile is one thing: the name, a statement, a photograph, a number, a link, a short list. There is no hero and no sequence of bands; the page is one continuous composition that the eye roams. It suits subjects with many small true things to show (a studio with work, writing, clients and news; a product with several distinct capabilities) and it replaces the generic bento by having real content in every tile and a strict system for sizes.",
    "composition": "A 12-column grid with 8px gaps and 8–12px outer margins, filled completely, no empty cells. Tiles use only four sizes (for example 6×4, 6×2, 3×2, 3×4 in column × row units of about 90px). Every tile is a flat filled rectangle: ground colour one step from the page, or a palette colour, or a photograph covering it. One radius everywhere (0, or 6–10px). The first screen contains: a name tile (the name at display size, the largest type on the page) with the wordmark set large, a statement tile with the description at 28–40px, two or three image tiles and one action tile in the accent colour. Text inside tiles is top-left aligned with 20–24px padding and never centred. Below the first screen the board continues with the same sizes; the last row is the footer made of tiles."
  },
  {
    "id": "uneven-photographs",
    "name": "Photographs at uneven sizes",
    "sectors": [
      "hospitality",
      "real-estate",
      "architecture",
      "fashion",
      "restaurant",
      "culture",
      "health",
      "nonprofit",
      "studio-portfolio",
      "physical-product"
    ],
    "tones": [
      "quiet",
      "luxury",
      "warm",
      "editorial"
    ],
    "needs": [],
    "needsPictures": true,
    "idea": "A calm page where the pictures are placed like prints on a gallery wall: each at its own size and position, with text set small and light between them. Nothing lines up in the obvious way, yet everything sits on a grid you can feel. The unevenness is what makes it read as art-directed by a person: a small portrait far left, a wide landscape running off the right edge, a square that overlaps the next section. It lets photographs lead without ever becoming a slideshow.",
    "composition": "A 12-column grid with wide margins (5–7vw). The hero is a single line of large light type (6–9vw) across the top third, and below it one photograph placed off-centre (columns 6–12, 16:10), its top edge overlapping the baseline zone of the headline by a few pixels of deliberate tension. Each following section places two or three photographs with different spans and vertical offsets: for example a 3:4 portrait in columns 2–5 starting 120px lower than a 16:10 landscape in columns 7–12; then a single small 1:1 in columns 9–11 beside a paragraph in columns 2–6. Paragraphs are short (max 40ch) and sit in the gaps. No two consecutive sections use the same arrangement. Vertical spacing is large and irregular on purpose (120–260px)."
  },
  {
    "id": "dark-room",
    "name": "The dark room",
    "sectors": [
      "hospitality",
      "restaurant",
      "music",
      "fashion",
      "physical-product",
      "finance",
      "architecture",
      "studio-portfolio",
      "ai-product",
      "personal-portfolio"
    ],
    "tones": [
      "quiet",
      "luxury"
    ],
    "needs": [],
    "idea": "One dark field from top to bottom, and in it, lit things. Photographs and objects appear like exhibits in a dim gallery: each with space around it, each the brightest thing on its screen. Type is light, small and sparse. The darkness is not a theme switch; it is a room, and the page is a slow walk through it. It suits subjects sold on atmosphere and material: an evening restaurant, a metal card, a record, a house at dusk.",
    "composition": "A single near-black or deep-toned ground runs the full page with no section bands. First screen: either the name at full width in a light weight along the bottom edge with one dim photograph above it, or one object or photograph centred at 40–50% of the viewport with a line of text beneath at 16–18px. Each later screen holds one or two lit items at a generous size (the main one 40–60% of the screen width) with its text set beside it at full reading size; the darkness frames the items, it does not replace content. Images vary in size but all share the same darkness at their edges so they sit in the ground without frames. Practical details come last in a simple two-column text block. The only solid light element on the page is the single primary action."
  },
  {
    "id": "type-only-statement",
    "name": "Type and nothing else",
    "sectors": [
      "saas",
      "dev-tool",
      "ai-product",
      "finance",
      "agency",
      "nonprofit",
      "education",
      "personal-portfolio",
      "event",
      "other"
    ],
    "tones": [
      "bold",
      "quiet",
      "editorial",
      "technical"
    ],
    "needs": [],
    "idea": "The first screen is made only of words, colour and space, good enough that nobody misses a picture there. Pictures arrive later, large and few, as relief from the type. This is the honest answer when a subject has nothing worth photographing: instead of inventing illustrations, set what you have to say as well as it can be set. The typography carries a point of view through scale (one enormous statement, everything else small), through measure (a narrow, bookish column or a full-width line), and through one committed colour.",
    "composition": "First screen: the statement, two lines at most, set at 9–14vw and occupying the full width with tight leading, positioned in the upper two-thirds. One supporting sentence at 20–24px sits bottom-left on the same margin and the single action sits bottom-right on the same baseline. No navigation bar; two or three links in a top corner. Sections that follow are typographic set pieces, each different: a list of five to eight capabilities set at 4–6vw one per line; a paragraph at 28–36px in a 28ch column pushed to the right half; a pair of large numerals with a sentence each; a single quotation filling a colour field. Each section uses a different horizontal position (left, right, full) so the page has movement without imagery."
  }
];
export const SECTORS = ['saas', 'dev-tool', 'ai-product', 'consumer-app', 'finance', 'agency', 'studio-portfolio', 'personal-portfolio', 'ecommerce', 'physical-product', 'fashion', 'hospitality', 'restaurant', 'real-estate', 'architecture', 'event', 'health', 'education', 'nonprofit', 'culture', 'music', 'other'] as const;
export const TONES = ['quiet', 'bold', 'warm', 'technical', 'playful', 'luxury', 'editorial'] as const;
export interface DrawInput { sector: string; tone: string | null; have: string[]; avoid: string[]; }
export interface FilterStage { key: string; label: string; ids: string[]; applied: boolean; condition: string; }
export interface DrawRound {
  state: number; unsigned: number; random: number; index: number;
  before: Direction[]; chosen: Direction; after: Direction[];
}
export const DEFAULT_INPUT: DrawInput = {sector: 'saas', tone: null, have: [], avoid: []};
export function imageryMode(input: DrawInput) {
  if (input.have.includes('product-photo') || input.have.includes('photography')) return 'own';
  if (['saas', 'dev-tool', 'ai-product', 'consumer-app', 'finance'].includes(input.sector)) return 'interface';
  if (['physical-product', 'ecommerce'].includes(input.sector)) return 'no-product-photo';
  return 'atmosphere';
}
/** Same order and fallback thresholds as upstream directionPool(). */
export function directionPool(input: DrawInput) {
  const stages: FilterStage[] = [];
  const record = (key: string, label: string, pool: Direction[], applied: boolean, condition: string) => {
    stages.push({key, label, ids: pool.map(d => d.id), applied, condition});
  };
  let pool = DIRECTIONS.filter(d => (d.sectors.includes(input.sector) || d.sectors.includes('*')) && !input.avoid.includes(d.id));
  record('sector', 'sector / avoid', pool, true, '保留匹配 sector 且未列入 avoid 的方向');
  const feasible = pool.filter(d => d.needs.every(need => input.have.includes(need) || need === 'photography'));
  if (feasible.length) pool = feasible;
  record('assets', 'needs', pool, feasible.length > 0, '只有可行池非空才应用素材条件');
  const mode = imageryMode(input);
  const plain = pool.filter(d => !d.needsPictures);
  const filterPictures = (mode === 'interface' || mode === 'no-product-photo') && plain.length >= 3;
  if (filterPictures) pool = plain;
  record('pictures', 'needsPictures', pool, filterPictures, `${mode}：无图片方向达到 3 个才排除 needsPictures`);
  const toned = input.tone ? pool.filter(d => d.tones.includes(input.tone!)) : [];
  const filterTone = !!input.tone && toned.length >= 2;
  if (filterTone) pool = toned;
  record('tone', 'tone', pool, filterTone, input.tone ? `${input.tone} 匹配 ${toned.length} 个；至少 2 个才收窄` : '未指定 tone，不收窄');
  if (!pool.length) pool = DIRECTIONS.filter(d => !input.avoid.includes(d.id));
  record('fallback', 'fallback', pool, !stages[stages.length - 1]!.ids.length, '若为空，退回所有未列入 avoid 的方向');
  return {pool, stages};
}
/** Upstream seedable PRNG, with intermediates exposed for the figure. */
export function nextRandom(previous: number) {
  let state = previous | 0;
  state = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(state ^ (state >>> 15), 1 | state);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const unsigned = (t ^ (t >>> 14)) >>> 0;
  return {state, unsigned, random: unsigned / 4294967296};
}
/** Three options; public teaching fixture keeps project/user history empty. */
export function drawDirections(seed: number, input: DrawInput = DEFAULT_INPUT) {
  const {pool, stages} = directionPool(input);
  let state = seed; let rest = [...pool];
  const rounds: DrawRound[] = [];
  while (rounds.length < 3 && pool.length > rounds.length) {
    if (!rest.length) rest = pool.filter(d => !rounds.some(round => round.chosen === d));
    const next = nextRandom(state); state = next.state;
    const index = Math.floor(next.random * rest.length);
    const chosen = rest[index]!;
    const after = rest.filter(d => d !== chosen);
    rounds.push({...next, index, before: rest, chosen, after}); rest = after;
  }
  return {seed, input, pool, stages, rounds};
}
export function directionNumber(id: string) { return DIRECTIONS.findIndex(d => d.id === id) + 1; }

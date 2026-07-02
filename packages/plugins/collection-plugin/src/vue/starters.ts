// Curated "start from a template" collection starters shown in the new-collection
// modal. Each entry's `prompt` is injected into the chat composer as an editable
// draft (the user reviews / sends it); `title` + `description` are the card face.
//
// All three strings are ENGLISH SOURCE — the modal translates them into the user's
// locale at runtime via the host's `/api/translation` route (namespace
// "collection-starters"), the same mechanism the host's role-query chips use.
// These prompts were previously per-role suggestion chips in the host's
// `roles.ts`; they live here now so they surface from the Collections UI
// independent of which role is active. (See plans/done/feat-collection-starters-modal.md.)
//
// `icon` is a Material Symbols name, matching the collection-card convention.

export interface CollectionStarter {
  /** Stable id (card key + translation grouping). */
  id: string;
  /** Material Symbols icon name. */
  icon: string;
  /** Card title — English source, runtime-translated. */
  title: string;
  /** One-line card description — English source, runtime-translated. */
  description: string;
  /** Prompt seeded into the composer as a draft — English source, runtime-translated. */
  prompt: string;
}

export const COLLECTION_STARTERS: readonly CollectionStarter[] = [
  {
    id: "todos",
    icon: "checklist",
    title: "Todo list",
    description: "Track tasks with due dates and status",
    prompt:
      "Set up a todo list. First read `config/helps/todo-collection.md` and follow it exactly to author the todos collection — do not redesign the schema or ask me design questions.",
  },
  {
    id: "contacts",
    icon: "contacts",
    title: "Contacts",
    description: "People with details, read from a business card photo",
    prompt:
      "Create a contacts collection with name, company, title, email, phone, notes, and a business-card image. When I attach a photo of a business card, read the details off it and add a new contact.",
  },
  {
    id: "reading-list",
    icon: "menu_book",
    title: "Reading list",
    description: "Save links to read, with unread reminders",
    prompt:
      "Create a reading-list collection with a title, a URL field, and a Read checkbox. While Read is unchecked, keep each item in the bell notifications, labeled with its title.",
  },
  {
    id: "restaurants",
    icon: "restaurant",
    title: "Restaurants",
    description: "Places to try, rate after you've visited",
    prompt:
      "Create a restaurants collection with name, cuisine, neighborhood, a website URL, a phone number, a Visited checkbox, a 1-to-5 rating, and notes. Hide the rating until I've marked a place as visited — there's nothing to rate before I've been.",
  },
  {
    id: "bills",
    icon: "receipt_long",
    title: "Bill Payments",
    description: "Recurring payments with due-date reminders",
    prompt:
      "Create a bills collection to track recurring payments — payee, amount, due date, and status. Remind me 10 days before each bill is due, and when I mark one paid, automatically set up next month's bill.",
  },
  {
    id: "clients-worklog",
    icon: "work",
    title: "Clients & time",
    description: "Consulting clients plus a worklog",
    prompt:
      "Set up client and time tracking for my consulting work. First read `config/helps/billing-clients-worklog.md` and follow it exactly to author the clients and worklog collections — do not redesign the schemas or ask me design questions.",
  },
  {
    id: "invoice",
    icon: "request_quote",
    title: "Invoicing",
    description: "Invoices and your business profile",
    prompt:
      "Set up invoicing for my business. First read `config/helps/billing-invoice.md` and follow it exactly to author the invoice and profile collections — do not redesign the schemas or ask me design questions.",
  },
  {
    id: "vocabulary",
    icon: "translate",
    title: "Vocabulary",
    description: "Words and sample sentences for a language",
    prompt:
      "I want to build my vocabulary in a new language — ask me which language I'm learning and my current level, then read config/helps/vocabulary.md, set up a vocabulary collection, and fill it with fifty words and sample sentences appropriate for my level to track my progress",
  },
  {
    id: "lessons",
    icon: "school",
    title: "Lessons",
    description: "A tracked course with a planned curriculum",
    prompt:
      "I want to learn a topic as a tracked course — ask me the topic, my goal, and my current level, then read config/helps/lessons-collection.md, set up a lessons collection, and plan the curriculum before teaching the first lesson",
  },
  {
    id: "portfolio",
    icon: "trending_up",
    title: "Stock portfolio",
    description: "A watchlist plus valued holdings",
    prompt:
      "Set up a stock portfolio tracker — a stock-quotes watchlist plus a portfolio that values my holdings against it. First read `config/helps/portfolio-tracker.md` and follow it exactly to author both collections — do not redesign the schemas or ask me design questions.",
  },
];

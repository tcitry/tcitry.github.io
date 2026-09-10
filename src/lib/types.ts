export interface Heading { depth: number; slug: string; text: string }
export interface ContentPage {
  id: string;
  source: string;
  url: string;
  title: string;
  kind: 'home' | 'page' | 'section' | 'taxonomy' | 'term';
  section: string;
  type: string;
  layout: string;
  date: string;
  lastmod: string;
  description: string;
  summary: string;
  html: string;
  /** Generated, public MDX module filename; never a BLOG_DIR filesystem path. */
  mdx?: string;
  headings: Heading[];
  tags: string[];
  categories: string[];
  aliases: string[];
  weight: number;
  hidden: boolean;
  collapse: boolean;
  toc: boolean;
  image: string;
  link: string;
  redirect: boolean;
  parent: string;
  wordCount: number;
  params: Record<string, unknown>;
}
export interface TaxonomyTerm { name: string; url: string; pageIds: string[] }
export interface SiteContent {
  pages: ContentPage[];
  tags: TaxonomyTerm[];
  categories: TaxonomyTerm[];
  diagnostics: { warnings: string[]; sourceCount: number };
}
export interface NavigationNode { page: ContentPage; children: NavigationNode[] }
export interface PageView {
  page: ContentPage;
  entries: ContentPage[];
  pagination?: { current: number; total: number; urls: string[] };
  term?: TaxonomyTerm;
}

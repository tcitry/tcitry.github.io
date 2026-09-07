/** Blog-only display data for custom weekly, timeline, portfolio and sidebar pages. */
export interface SiteLink { label: string; href: string; target?: '_blank' | '_self'; }
export interface TimelineItem { id?: string; label: string; /** Trusted, authored Blog HTML. */ html: string; }
export interface PortfolioItem extends SiteLink {
  period: string;
  imageHTML?: string;
  tags?: string[];
  detailsHTML?: string[];
}
export interface WeeklyCardItem extends SiteLink { description?: string; image: { src: string; alt: string }; dateLabel?: string; }
export interface SidebarRow extends SiteLink { dateLabel?: string; active?: boolean; }

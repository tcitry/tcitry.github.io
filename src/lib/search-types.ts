export interface SearchEntry {
  url: string;
  title: string;
  excerpt?: string;
  updated?: string;
  section?: string;
}

export interface SearchResponse {
  results: SearchEntry[];
  total: number;
}

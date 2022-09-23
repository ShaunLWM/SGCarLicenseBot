declare module 'google-search-results-nodejs';
interface ResultSuccess {
  success: true;
  license: string;
  carMake: string;
  roadTaxExpiry?: string;
  lastUpdated?: string;
  type: "search";
}

interface ResultFailed {
  success: false;
  message?: string;
  license?: string;
}

interface ResultImageSearch {
  success: true;
  type: "image";
  isAnother: boolean;
  isHd: boolean;
  carMake: string;
  carIndex: number;
}

type ScrapeResult = ResultSuccess | ResultFailed | ResultImageSearch;


/* SerpApi */
interface SerpApiResult {
  search_metadata: SearchMetadata
  search_parameters: SearchParameters
  search_information: SearchInformation
  suggested_searches: SuggestedSearch[]
  images_results: ImagesResult[]
}

interface SearchMetadata {
  id: string
  status: string
  json_endpoint: string
  created_at: string
  processed_at: string
  google_url: string
  raw_html_file: string
  total_time_taken: number
}

interface SearchParameters {
  engine: string
  q: string
  location_requested: string
  location_used: string
  google_domain: string
  hl: string
  gl: string
  device: string
  tbm: string
  filter: string
}

interface SearchInformation {
  image_results_state: string
  query_displayed: string
  menu_items: MenuItem[]
}

interface MenuItem {
  position: number
  title: string
  link?: string
  serpapi_link?: string
}

interface SuggestedSearch {
  name: string
  link: string
  chips: string
  serpapi_link: string
  thumbnail?: string
}

interface ImagesResult {
  position: number
  thumbnail: string
  source: string
  title: string
  link: string
  original: string
  is_product: boolean
}

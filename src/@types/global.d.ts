interface ResultSuccess {
  success: true;
  carMake: string;
  roadTaxExpiry?: string;
  lastUpdated?: string;
}

interface ResultFailed {
  success: false;
  message?: string;
}

type ScrapeResult = ResultSuccess | ResultFailed;

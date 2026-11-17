// The pods' testing campaigns (owner): "CBO | Internal Pod | Testing", "CBO | Internal Pod | Testing #2"
// (Nov 17) and "CBO | TOF Ads | Test" (Nov 12). Matched as part of the campaign name, any case, so a
// numbered follow-up ("… Testing #3") counts too. Crediting never depends on these: any ad set naming a
// pod is a test, whatever its campaign. They pick the ads for the Dashboard's new launches and Ad Swipe.
export const POD_TEST_CAMPAIGNS = ["Internal Pod | Testing", "TOF Ads | Test"] as const;

/** Whether a campaign is one of the pods' testing campaigns. */
export function isPodTestCampaign(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return POD_TEST_CAMPAIGNS.some((p) => n.includes(p.toLowerCase()));
}

/** The same list as /api/rankings?campaigns= takes it. */
export const POD_TEST_CAMPAIGNS_PARAM = POD_TEST_CAMPAIGNS.join(",");

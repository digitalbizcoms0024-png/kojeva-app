// The pods' testing campaigns (owner): "CBO | Internal Pod | Testing", "CBO | Internal Pod | Testing #2"
// (Nov 17), "CBO | Internal Pod | Testing #3" (natives only, Nov 19) and "CBO | TOF Ads | Test" (Nov 12). Matched as part of the campaign name, any case, so a
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

// The pods' natives-only testing campaign (owner, Nov 19): every concept in it is Native, whatever its
// ad set says (a format set by hand still wins). Matched as part of the name, any case.
export const NATIVE_TEST_CAMPAIGNS = ["Internal Pod | Testing #3"] as const;

/** Whether a campaign is the natives-only testing campaign. "#3" must not be the start of "#30". */
export function isNativeTestCampaign(name: string | null | undefined): boolean {
  const n = (name ?? "").toLowerCase();
  return NATIVE_TEST_CAMPAIGNS.some((p) => {
    const i = n.indexOf(p.toLowerCase());
    return i >= 0 && !/\d/.test(n.charAt(i + p.length));
  });
}

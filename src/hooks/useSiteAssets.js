import { useEffect, useState } from "react";
import { apiRequest, siteAssetUrl } from "../api";

export default function useSiteAssets() {
  const [assets, setAssets] = useState({});

  useEffect(() => {
    let current = true;
    apiRequest("/site-assets")
      .then((result) => {
        if (!current) return;
        setAssets(Object.fromEntries(
          Object.entries(result.assets || {}).map(([key, asset]) => [
            key,
            siteAssetUrl(key, asset.updatedAt),
          ]),
        ));
      })
      .catch((error) => {
        console.error("Could not load custom site images:", error);
      });
    return () => { current = false; };
  }, []);

  return assets;
}

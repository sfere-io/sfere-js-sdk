// A minimal React app on the built bindings, bundled by global-setup.ts into two variants:
// development (StrictMode double-renders and double-runs effects) and production (what apps ship).
// global-setup.ts copies it next to the packed and extracted tarball, so "@sfere-io/sfere-sdk/react"
// resolves through the published "exports" map and files, exactly as in a client app's bundler.
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { SfereProvider, usePageTracking, useSfere } from "@sfere-io/sfere-sdk/react";

type Win = Window & { __reactReady?: boolean; __navigate?: (path: string) => void };
const win = window as Win;

function PageViews({ route }: { route: string }) {
  usePageTracking(route);
  return null;
}

function Shop() {
  const sfere = useSfere();
  return (
    <div>
      <button
        id="add"
        onClick={() =>
          void sfere.track("add_to_cart", {
            currency: "SAR",
            value: 89.99,
            items: [{ item_id: "sku_123", item_name: "Jersey", price: 89.99, quantity: 1 }],
          })
        }
      >
        add
      </button>
      <button id="login" onClick={() => void sfere.identify("user_e2e", { email: "fan@example.com" })}>
        login
      </button>
      <button id="consent" onClick={() => sfere.setConsent({ advertising: true, analytics: false })}>
        consent
      </button>
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(location.pathname);
  // A client-side router in one line: pushState, then re-render with the new route.
  win.__navigate = (path: string) => {
    history.pushState(null, "", path);
    setRoute(path);
  };
  return (
    <SfereProvider writeKey="keyIdE2E:secretE2E" host="http://127.0.0.1:4311">
      <PageViews route={route} />
      <Shop />
      <p id="route">{route}</p>
    </SfereProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
win.__reactReady = true;

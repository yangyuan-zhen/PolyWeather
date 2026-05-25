/* Barrel: pre-combined scan-terminal root class name.
   Consolidates 20 CSS Modules that are always co-imported into
   a single className, keeping ScanTerminalDashboard.tsx lean. */

/* Barrel: pre-combined scan-terminal root class name. */
import clsx from "clsx";

import scanTerminalStyles from "./ScanTerminal.module.css";
import scanTerminalBoardStyles from "./ScanTerminalBoard.module.css";
import scanTerminalCardStyles from "./ScanTerminalCard.module.css";
import scanTerminalDetailStyles from "./ScanTerminalDetail.module.css";
import scanTerminalFiltersStyles from "./ScanTerminalFilters.module.css";
import scanTerminalListStyles from "./ScanTerminalList.module.css";
import scanTerminalMobileStyles from "./ScanTerminalMobile.module.css";
import scanTerminalOpportunityStyles from "./ScanTerminalOpportunity.module.css";
import scanTerminalShellStyles from "./ScanTerminalShell.module.css";
import scanTerminalContinentStyles from "./ScanTerminalContinent.module.css";
import scanTerminalStateStyles from "./ScanTerminalState.module.css";

export const scanRootClass = clsx(
  scanTerminalStyles.root,
  scanTerminalShellStyles.root,
  scanTerminalFiltersStyles.root,
  scanTerminalListStyles.root,
  scanTerminalBoardStyles.root,
  scanTerminalDetailStyles.root,
  scanTerminalStateStyles.root,
  scanTerminalOpportunityStyles.root,
  scanTerminalCardStyles.root,
  scanTerminalContinentStyles.root,
  scanTerminalMobileStyles.root,
);

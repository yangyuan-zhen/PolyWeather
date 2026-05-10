/* Barrel: pre-combined scan-terminal root class name.
   Consolidates 22 CSS Modules that are always co-imported into
   a single className, keeping ScanTerminalDashboard.tsx lean. */

import clsx from "clsx";

import dashboardHomeStyles from "./DashboardHomeIntelligence.module.css";
import dashboardMapStyles from "./DashboardMap.module.css";
import dashboardModalGuideStyles from "./DashboardModalGuide.module.css";
import dashboardShellStyles from "./DashboardShell.module.css";
import detailChromeStyles from "./DetailPanelChrome.module.css";
import detailContentStyles from "./DetailPanelContent.module.css";
import detailSectionsStyles from "./DetailPanelSections.module.css";
import futureForecastModalStyles from "./FutureForecastModal.module.css";
import historyModalStyles from "./HistoryModal.module.css";
import modalChromeStyles from "./ModalChrome.module.css";
import scanTerminalStyles from "./ScanTerminal.module.css";
import scanTerminalBoardStyles from "./ScanTerminalBoard.module.css";
import scanTerminalCardStyles from "./ScanTerminalCard.module.css";
import scanTerminalDetailStyles from "./ScanTerminalDetail.module.css";
import scanTerminalFiltersStyles from "./ScanTerminalFilters.module.css";
import scanTerminalLightThemeStyles from "./ScanTerminalLightTheme.module.css";
import scanTerminalListStyles from "./ScanTerminalList.module.css";
import scanTerminalMobileStyles from "./ScanTerminalMobile.module.css";
import scanTerminalOpportunityStyles from "./ScanTerminalOpportunity.module.css";
import scanTerminalShellStyles from "./ScanTerminalShell.module.css";
import scanTerminalStateStyles from "./ScanTerminalState.module.css";

export const scanRootClass = clsx(
  dashboardHomeStyles.root,
  dashboardMapStyles.root,
  dashboardShellStyles.root,
  dashboardModalGuideStyles.root,
  scanTerminalStyles.root,
  scanTerminalShellStyles.root,
  scanTerminalFiltersStyles.root,
  scanTerminalListStyles.root,
  scanTerminalBoardStyles.root,
  scanTerminalDetailStyles.root,
  scanTerminalStateStyles.root,
  scanTerminalOpportunityStyles.root,
  scanTerminalCardStyles.root,
  scanTerminalMobileStyles.root,
  scanTerminalLightThemeStyles.root,
  detailChromeStyles.root,
  detailContentStyles.root,
  detailSectionsStyles.root,
  modalChromeStyles.root,
  futureForecastModalStyles.root,
  historyModalStyles.root,
);

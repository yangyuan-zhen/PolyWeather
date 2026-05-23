import { useCallback, useState } from "react";

import type { CreatedIntent } from "./types";

export type PaymentTxValidationState = {
  loading: boolean;
  checked: boolean;
  valid?: boolean;
  reason?: string;
  detail?: string;
  checks?: Record<string, unknown>;
};

export function usePaymentState() {
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentInfo, setPaymentInfo] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [lastIntentId, setLastIntentId] = useState("");
  const [lastTxHash, setLastTxHash] = useState("");
  const [telegramBindOpening, setTelegramBindOpening] = useState(false);
  const [manualPayment, setManualPayment] = useState<
    CreatedIntent["direct_payment"] | null
  >(null);
  const [manualTxHash, setManualTxHash] = useState("");
  const [txValidation, setTxValidation] = useState<PaymentTxValidationState>({
    loading: false,
    checked: false,
  });
  const [paymentMethodTab, setPaymentMethodTab] = useState<"wallet" | "manual">(
    "wallet",
  );
  const [lastPaymentStartedAt, setLastPaymentStartedAt] = useState(0);

  const clearPaymentMessages = useCallback(() => {
    setPaymentError("");
    setPaymentInfo("");
  }, []);

  const clearPaymentState = useCallback(() => {
    setLastIntentId("");
    setLastTxHash("");
    setManualPayment(null);
    setManualTxHash("");
    setLastPaymentStartedAt(0);
    setTxValidation({ loading: false, checked: false });
  }, []);

  return {
    paymentBusy,
    setPaymentBusy,
    paymentInfo,
    setPaymentInfo,
    paymentError,
    setPaymentError,
    lastIntentId,
    setLastIntentId,
    lastTxHash,
    setLastTxHash,
    telegramBindOpening,
    setTelegramBindOpening,
    manualPayment,
    setManualPayment,
    manualTxHash,
    setManualTxHash,
    txValidation,
    setTxValidation,
    paymentMethodTab,
    setPaymentMethodTab,
    lastPaymentStartedAt,
    setLastPaymentStartedAt,
    clearPaymentMessages,
    clearPaymentState,
  };
}

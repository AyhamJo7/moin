// @moin/telephony — ConversationRelay protocol codecs, TwiML builders, Twilio signature validation
// and the protocol simulator.
//
// Declared in P02.03 so the workspace graph and the module-boundary rules were complete; filled in
// P04.04, which builds the production-quality adapter early because it is the riskiest assumption
// in the product (PLAN P04). P11 consumes it; nothing here is a spike to be thrown away.

export { escapeXml } from './twiml/escape.ts';
export { buildConversationRelayTwiML, TwiMLBuildError } from './twiml/connect-relay.ts';
export type {
  ConversationRelayOptions,
  TranscriptionConfig,
  SpeechConfig,
} from './twiml/connect-relay.ts';

export {
  setupMessage,
  promptMessage,
  interruptMessage,
  dtmfMessage,
  errorMessage,
  inboundMessage,
  KNOWN_INBOUND_TYPES,
} from './protocol/inbound.ts';
export type {
  SetupMessage,
  PromptMessage,
  InterruptMessage,
  DtmfMessage,
  ErrorMessage,
  InboundMessage,
} from './protocol/inbound.ts';

export {
  textMessage,
  playMessage,
  sendDigitsMessage,
  languageMessage,
  endMessage,
  outboundMessage,
  text,
  play,
  sendDigits,
  switchLanguage,
  end,
} from './protocol/outbound.ts';
export type {
  TextMessage,
  PlayMessage,
  SendDigitsMessage,
  LanguageMessage,
  EndMessage,
  OutboundMessage,
} from './protocol/outbound.ts';

export { decodeInbound, encodeOutbound } from './protocol/codec.ts';
export type { DecodeResult } from './protocol/codec.ts';

export { reconstructRequestUrl, OriginConfigError } from './signature/url.ts';
export type { ReconstructInput, ReconstructResult, OriginMismatch } from './signature/url.ts';

export {
  signatureBaseString,
  computeSignature,
  isValidSignature,
  isValidBodyHash,
  validateJsonWebhook,
  validateFormWebhook,
} from './signature/validate.ts';
export type { SignatureInput, WebhookVerdict } from './signature/validate.ts';

export {
  SESSION_TOKEN_TTL_MS,
  issueSessionToken,
  consumeSessionToken,
  createInMemorySessionTokenStore,
} from './session/token.ts';
export type {
  SessionTokenStore,
  StoredSessionToken,
  IssuedSessionToken,
  SessionTokenVerdict,
} from './session/token.ts';

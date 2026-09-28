// GA4 e-commerce vocabulary: the canonical event names and `properties` shapes for Sfere.
// Types only. The SDK passes event names and properties through untouched.
// Reference: https://developers.google.com/analytics/devguides/collection/ga4/reference/events

/** One product line in `properties.items[]`. */
export interface Item {
  item_id?: string;
  item_name?: string;
  affiliation?: string;
  coupon?: string;
  discount?: number;
  index?: number;
  item_brand?: string;
  item_category?: string;
  item_category2?: string;
  item_category3?: string;
  item_category4?: string;
  item_category5?: string;
  item_list_id?: string;
  item_list_name?: string;
  item_variant?: string;
  location_id?: string;
  price?: number;
  quantity?: number;
  [key: string]: unknown;
}

/** Properties Sfere adds or reads on every `track` event. */
export interface SfereTrackProperties {
  /** Shared by browser pixels and server destinations; defaults to the event's `messageId`. */
  sfere_dedup_id?: string;
  [key: string]: unknown;
}

export interface ValueProperties extends SfereTrackProperties {
  /** ISO 4217 currency code, required by GA4 whenever `value` is set. */
  currency?: string;
  value?: number;
}

export interface ItemsProperties extends ValueProperties {
  items?: Item[];
}

export interface PurchaseProperties extends ItemsProperties {
  transaction_id: string;
  coupon?: string;
  shipping?: number;
  tax?: number;
}

export interface RefundProperties extends ItemsProperties {
  transaction_id: string;
  coupon?: string;
  shipping?: number;
  tax?: number;
}

export interface BeginCheckoutProperties extends ItemsProperties {
  coupon?: string;
}

export interface AddPaymentInfoProperties extends ItemsProperties {
  coupon?: string;
  payment_type?: string;
}

export interface AddShippingInfoProperties extends ItemsProperties {
  coupon?: string;
  shipping_tier?: string;
}

export interface ItemListProperties extends SfereTrackProperties {
  item_list_id?: string;
  item_list_name?: string;
  items?: Item[];
}

export interface SearchProperties extends SfereTrackProperties {
  search_term: string;
}

export interface MethodProperties extends SfereTrackProperties {
  method?: string;
}

/** Event name -> `properties` shape. */
export interface EcommerceEventMap {
  purchase: PurchaseProperties;
  refund: RefundProperties;
  add_to_cart: ItemsProperties;
  remove_from_cart: ItemsProperties;
  add_to_wishlist: ItemsProperties;
  view_item: ItemsProperties;
  view_cart: ItemsProperties;
  begin_checkout: BeginCheckoutProperties;
  add_payment_info: AddPaymentInfoProperties;
  add_shipping_info: AddShippingInfoProperties;
  view_item_list: ItemListProperties;
  select_item: ItemListProperties;
  search: SearchProperties;
  sign_up: MethodProperties;
  login: MethodProperties;
  generate_lead: ValueProperties;
}

export type EcommerceEventName = keyof EcommerceEventMap;

export type EcommerceProperties<E extends EcommerceEventName> = EcommerceEventMap[E];

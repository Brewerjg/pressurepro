export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      catalog_items: {
        Row: {
          app: string
          archived: boolean
          cost_per_unit: number
          cost_unit: string | null
          created_at: string
          default_rate: number
          description: string | null
          id: string
          kind: Database["public"]["Enums"]["catalog_kind"]
          min_charge: number
          mode: string | null
          name: string
          sort_order: number
          surface_type: string | null
          unit: Database["public"]["Enums"]["pricing_unit"] | null
          updated_at: string
          user_id: string
        }
        Insert: {
          app?: string
          archived?: boolean
          cost_per_unit?: number
          cost_unit?: string | null
          created_at?: string
          default_rate?: number
          description?: string | null
          id?: string
          kind: Database["public"]["Enums"]["catalog_kind"]
          min_charge?: number
          mode?: string | null
          name: string
          sort_order?: number
          surface_type?: string | null
          unit?: Database["public"]["Enums"]["pricing_unit"] | null
          updated_at?: string
          user_id: string
        }
        Update: {
          app?: string
          archived?: boolean
          cost_per_unit?: number
          cost_unit?: string | null
          created_at?: string
          default_rate?: number
          description?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["catalog_kind"]
          min_charge?: number
          mode?: string | null
          name?: string
          sort_order?: number
          surface_type?: string | null
          unit?: Database["public"]["Enums"]["pricing_unit"] | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      crews: {
        Row: {
          color: string
          created_at: string
          id: string
          name: string
          updated_at: string
          user_id: string
        }
        Insert: {
          color?: string
          created_at?: string
          id?: string
          name: string
          updated_at?: string
          user_id: string
        }
        Update: {
          color?: string
          created_at?: string
          id?: string
          name?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          primary_address: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          primary_address?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          primary_address?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      maintenance_plans: {
        Row: {
          address: string
          amount: number
          app: string
          card_last4: string | null
          charge_history: Json
          created_at: string
          customer_id: string | null
          customer_name: string
          id: string
          interval_months: number
          next_charge_date: string
          phone: string
          portal_token: string
          property_id: string | null
          services: string[]
          start_date: string
          status: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id: string | null
          stripe_price_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address?: string
          amount: number
          app?: string
          card_last4?: string | null
          charge_history?: Json
          created_at?: string
          customer_id?: string | null
          customer_name: string
          id?: string
          interval_months: number
          next_charge_date: string
          phone?: string
          portal_token?: string
          property_id?: string | null
          services?: string[]
          start_date: string
          status?: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          amount?: number
          app?: string
          card_last4?: string | null
          charge_history?: Json
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          id?: string
          interval_months?: number
          next_charge_date?: string
          phone?: string
          portal_token?: string
          property_id?: string | null
          services?: string[]
          start_date?: string
          status?: Database["public"]["Enums"]["plan_status"]
          stripe_customer_id?: string | null
          stripe_price_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_plans_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_plans_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      photo_pairs: {
        Row: {
          address: string | null
          after_path: string | null
          app: string
          backup_bytes: number | null
          before_path: string | null
          capture_device_id: string | null
          created_at: string
          customer_id: string | null
          device_after_id: string | null
          device_before_id: string | null
          id: string
          property_id: string | null
          quote_id: string | null
          thumb_after_path: string | null
          thumb_before_path: string | null
          user_id: string
        }
        Insert: {
          address?: string | null
          after_path?: string | null
          app?: string
          backup_bytes?: number | null
          before_path?: string | null
          capture_device_id?: string | null
          created_at?: string
          customer_id?: string | null
          device_after_id?: string | null
          device_before_id?: string | null
          id?: string
          property_id?: string | null
          quote_id?: string | null
          thumb_after_path?: string | null
          thumb_before_path?: string | null
          user_id: string
        }
        Update: {
          address?: string | null
          after_path?: string | null
          app?: string
          backup_bytes?: number | null
          before_path?: string | null
          capture_device_id?: string | null
          created_at?: string
          customer_id?: string | null
          device_after_id?: string | null
          device_before_id?: string | null
          id?: string
          property_id?: string | null
          quote_id?: string | null
          thumb_after_path?: string | null
          thumb_before_path?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "photo_pairs_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_pairs_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "photo_pairs_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          business_name: string | null
          connect_completed_at: string | null
          connect_ready: boolean
          created_at: string
          display_name: string | null
          google_place_id: string | null
          id: string
          is_demo: boolean
          name: string | null
          onboarded_at: string | null
          phone: string | null
          stripe_account_id: string | null
          stripe_customer_id: string | null
          updated_at: string
          user_id: string
          zip: string | null
        }
        Insert: {
          business_name?: string | null
          connect_completed_at?: string | null
          connect_ready?: boolean
          created_at?: string
          display_name?: string | null
          google_place_id?: string | null
          id?: string
          is_demo?: boolean
          name?: string | null
          onboarded_at?: string | null
          phone?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id: string
          zip?: string | null
        }
        Update: {
          business_name?: string | null
          connect_completed_at?: string | null
          connect_ready?: boolean
          created_at?: string
          display_name?: string | null
          google_place_id?: string | null
          id?: string
          is_demo?: boolean
          name?: string | null
          onboarded_at?: string | null
          phone?: string | null
          stripe_account_id?: string | null
          stripe_customer_id?: string | null
          updated_at?: string
          user_id?: string
          zip?: string | null
        }
        Relationships: []
      }
      properties: {
        Row: {
          address: string
          created_at: string
          customer_id: string
          dog_warning: boolean
          gate_code: string | null
          id: string
          lat: number | null
          lng: number | null
          photo_url: string | null
          sqft: number | null
          surface_notes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          address: string
          created_at?: string
          customer_id: string
          dog_warning?: boolean
          gate_code?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          photo_url?: string | null
          sqft?: number | null
          surface_notes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          address?: string
          created_at?: string
          customer_id?: string
          dog_warning?: boolean
          gate_code?: string | null
          id?: string
          lat?: number | null
          lng?: number | null
          photo_url?: string | null
          sqft?: number | null
          surface_notes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "properties_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      quote_views: {
        Row: {
          created_at: string
          id: string
          quote_id: string
          referrer: string | null
          user_agent: string | null
          viewed_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          quote_id: string
          referrer?: string | null
          user_agent?: string | null
          viewed_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          quote_id?: string
          referrer?: string | null
          user_agent?: string | null
          viewed_at?: string
        }
        Relationships: []
      }
      quote_reviews: {
        Row: {
          id: string
          quote_id: string
          rating: number
          comment: string | null
          routed_to_google: boolean
          submitted_at: string
          submitted_ip: string | null
          user_agent: string | null
        }
        Insert: {
          id?: string
          quote_id: string
          rating: number
          comment?: string | null
          routed_to_google?: boolean
          submitted_at?: string
          submitted_ip?: string | null
          user_agent?: string | null
        }
        Update: {
          id?: string
          quote_id?: string
          rating?: number
          comment?: string | null
          routed_to_google?: boolean
          submitted_at?: string
          submitted_ip?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_reviews_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          }
        ]
      }
      quote_acceptances: {
        Row: {
          id: string
          quote_id: string
          signed_name: string
          signed_at: string
          signed_ip: string | null
          user_agent: string | null
        }
        Insert: {
          id?: string
          quote_id: string
          signed_name: string
          signed_at?: string
          signed_ip?: string | null
          user_agent?: string | null
        }
        Update: {
          id?: string
          quote_id?: string
          signed_name?: string
          signed_at?: string
          signed_ip?: string | null
          user_agent?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quote_acceptances_quote_id_fkey"
            columns: ["quote_id"]
            isOneToOne: false
            referencedRelation: "quotes"
            referencedColumns: ["id"]
          }
        ]
      }
      quotes: {
        Row: {
          address: string
          app: string
          balance_paid_at: string | null
          balance_session_id: string | null
          cost: Json | null
          created_at: string
          customer_id: string | null
          customer_name: string
          deposit_amount: number | null
          deposit_paid_at: string | null
          deposit_session_id: string | null
          expires_at: string | null
          id: string
          crew_id: string | null
          customer_email: string | null
          emailed_at: string | null
          last_followup_at: string | null
          lines: Json
          notes: string | null
          parcel_sqft: number | null
          phone: string
          plan_id: string | null
          property_id: string | null
          recurring_months: number | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["quote_status"]
          total: number
          updated_at: string
          user_id: string
          view_count: number
          viewed_at: string | null
        }
        Insert: {
          address?: string
          app?: string
          balance_paid_at?: string | null
          balance_session_id?: string | null
          cost?: Json | null
          created_at?: string
          customer_id?: string | null
          customer_name: string
          deposit_amount?: number | null
          deposit_paid_at?: string | null
          deposit_session_id?: string | null
          expires_at?: string | null
          id?: string
          crew_id?: string | null
          customer_email?: string | null
          emailed_at?: string | null
          last_followup_at?: string | null
          lines?: Json
          notes?: string | null
          parcel_sqft?: number | null
          phone?: string
          plan_id?: string | null
          property_id?: string | null
          recurring_months?: number | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          updated_at?: string
          user_id: string
          view_count?: number
          viewed_at?: string | null
        }
        Update: {
          address?: string
          app?: string
          balance_paid_at?: string | null
          balance_session_id?: string | null
          cost?: Json | null
          created_at?: string
          customer_id?: string | null
          customer_name?: string
          deposit_amount?: number | null
          deposit_paid_at?: string | null
          deposit_session_id?: string | null
          expires_at?: string | null
          id?: string
          crew_id?: string | null
          customer_email?: string | null
          emailed_at?: string | null
          last_followup_at?: string | null
          lines?: Json
          notes?: string | null
          parcel_sqft?: number | null
          phone?: string
          plan_id?: string | null
          property_id?: string | null
          recurring_months?: number | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["quote_status"]
          total?: number
          updated_at?: string
          user_id?: string
          view_count?: number
          viewed_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "quotes_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "quotes_property_id_fkey"
            columns: ["property_id"]
            isOneToOne: false
            referencedRelation: "properties"
            referencedColumns: ["id"]
          },
        ]
      }
      short_links: {
        Row: {
          click_count: number
          code: string
          created_at: string
          id: string
          kind: string
          target_url: string
          updated_at: string
          user_id: string
        }
        Insert: {
          click_count?: number
          code: string
          created_at?: string
          id?: string
          kind?: string
          target_url: string
          updated_at?: string
          user_id: string
        }
        Update: {
          click_count?: number
          code?: string
          created_at?: string
          id?: string
          kind?: string
          target_url?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          cancel_at_period_end: boolean
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          environment: string
          id: string
          price_id: string | null
          product_id: string | null
          status: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_end: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          cancel_at_period_end?: boolean
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          environment?: string
          id?: string
          price_id?: string | null
          product_id?: string | null
          status?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_end?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      surface_pricing: {
        Row: {
          created_at: string
          default_rate: number
          id: string
          min_charge: number
          mode: string
          surface_type: string
          unit: Database["public"]["Enums"]["pricing_unit"]
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          default_rate?: number
          id?: string
          min_charge?: number
          mode?: string
          surface_type: string
          unit?: Database["public"]["Enums"]["pricing_unit"]
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          default_rate?: number
          id?: string
          min_charge?: number
          mode?: string
          surface_type?: string
          unit?: Database["public"]["Enums"]["pricing_unit"]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      user_storage_usage: {
        Row: {
          backup_bytes: number
          updated_at: string
          user_id: string
        }
        Insert: {
          backup_bytes?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          backup_bytes?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_settings: {
        Row: {
          business: string
          created_at: string
          deposit_percent: number
          fuel_cost_per_job: number
          gallons_per_sqft: number
          labor_rate: number
          phone: string
          quote_expiry_days: number
          rain_threshold_pct: number
          seasonal_pricing: boolean
          sh_cost_per_gal: number
          surfactant_cost_per_oz: number
          updated_at: string
          user_id: string
          water_cost_per_gal: number
          watermark: boolean
          zip: string
        }
        Insert: {
          business?: string
          created_at?: string
          deposit_percent?: number
          fuel_cost_per_job?: number
          gallons_per_sqft?: number
          labor_rate?: number
          phone?: string
          quote_expiry_days?: number
          rain_threshold_pct?: number
          seasonal_pricing?: boolean
          sh_cost_per_gal?: number
          surfactant_cost_per_oz?: number
          updated_at?: string
          user_id: string
          water_cost_per_gal?: number
          watermark?: boolean
          zip?: string
        }
        Update: {
          business?: string
          created_at?: string
          deposit_percent?: number
          fuel_cost_per_job?: number
          gallons_per_sqft?: number
          labor_rate?: number
          phone?: string
          quote_expiry_days?: number
          rain_threshold_pct?: number
          seasonal_pricing?: boolean
          sh_cost_per_gal?: number
          surfactant_cost_per_oz?: number
          updated_at?: string
          user_id?: string
          water_cost_per_gal?: number
          watermark?: boolean
          zip?: string
        }
        Relationships: []
      }
      weather_cache: {
        Row: {
          country: string
          created_at: string
          daily: Json
          fetched_at: string
          id: string
          lat: number
          lng: number
          updated_at: string
          zip: string
        }
        Insert: {
          country?: string
          created_at?: string
          daily?: Json
          fetched_at?: string
          id?: string
          lat: number
          lng: number
          updated_at?: string
          zip: string
        }
        Update: {
          country?: string
          created_at?: string
          daily?: Json
          fetched_at?: string
          id?: string
          lat?: number
          lng?: number
          updated_at?: string
          zip?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      public_business_info: {
        Args: { p_user_id: string }
        Returns: {
          business_name: string | null
          phone: string | null
          google_place_id: string | null
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
      catalog_kind: "service" | "chemical"
      plan_status: "active" | "paused" | "canceled"
      pricing_unit: "sqft" | "linear_ft" | "flat"
      quote_status:
        | "draft"
        | "sent"
        | "accepted"
        | "scheduled"
        | "complete"
        | "paid"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      catalog_kind: ["service", "chemical"],
      plan_status: ["active", "paused", "canceled"],
      pricing_unit: ["sqft", "linear_ft", "flat"],
      quote_status: [
        "draft",
        "sent",
        "accepted",
        "scheduled",
        "complete",
        "paid",
      ],
    },
  },
} as const

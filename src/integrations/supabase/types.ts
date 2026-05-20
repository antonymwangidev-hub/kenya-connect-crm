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
      automation_rules: {
        Row: {
          action: Database["public"]["Enums"]["automation_action"]
          action_payload: Json
          business_id: string
          condition: Json
          created_at: string
          id: string
          is_active: boolean
          name: string
          trigger: Database["public"]["Enums"]["automation_trigger"]
        }
        Insert: {
          action: Database["public"]["Enums"]["automation_action"]
          action_payload?: Json
          business_id: string
          condition?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          trigger: Database["public"]["Enums"]["automation_trigger"]
        }
        Update: {
          action?: Database["public"]["Enums"]["automation_action"]
          action_payload?: Json
          business_id?: string
          condition?: Json
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          trigger?: Database["public"]["Enums"]["automation_trigger"]
        }
        Relationships: []
      }
      automation_runs: {
        Row: {
          business_id: string
          contact_id: string | null
          created_at: string
          detail: string | null
          id: string
          rule_id: string
          status: string
        }
        Insert: {
          business_id: string
          contact_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          rule_id: string
          status?: string
        }
        Update: {
          business_id?: string
          contact_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          rule_id?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "automation_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "automation_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcast_recipients: {
        Row: {
          broadcast_id: string
          channel: string | null
          contact_id: string
          error: string | null
          id: string
          sent_at: string | null
          status: string
        }
        Insert: {
          broadcast_id: string
          channel?: string | null
          contact_id: string
          error?: string | null
          id?: string
          sent_at?: string | null
          status?: string
        }
        Update: {
          broadcast_id?: string
          channel?: string | null
          contact_id?: string
          error?: string | null
          id?: string
          sent_at?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "broadcast_recipients_broadcast_id_fkey"
            columns: ["broadcast_id"]
            isOneToOne: false
            referencedRelation: "broadcasts"
            referencedColumns: ["id"]
          },
        ]
      }
      broadcasts: {
        Row: {
          business_id: string
          content: string
          created_at: string
          failed_count: number
          id: string
          name: string
          sent_count: number
          total_recipients: number
        }
        Insert: {
          business_id: string
          content: string
          created_at?: string
          failed_count?: number
          id?: string
          name: string
          sent_count?: number
          total_recipients?: number
        }
        Update: {
          business_id?: string
          content?: string
          created_at?: string
          failed_count?: number
          id?: string
          name?: string
          sent_count?: number
          total_recipients?: number
        }
        Relationships: []
      }
      businesses: {
        Row: {
          created_at: string
          id: string
          name: string
          owner_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          owner_id: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          owner_id?: string
        }
        Relationships: []
      }
      contact_tags: {
        Row: {
          contact_id: string
          tag_id: string
        }
        Insert: {
          contact_id: string
          tag_id: string
        }
        Update: {
          contact_id?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "contact_tags_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "contact_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      contacts: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
          phone: string
          stage: Database["public"]["Enums"]["contact_stage"]
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
          phone: string
          stage?: Database["public"]["Enums"]["contact_stage"]
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
          phone?: string
          stage?: Database["public"]["Enums"]["contact_stage"]
        }
        Relationships: [
          {
            foreignKeyName: "contacts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      messages: {
        Row: {
          channel: Database["public"]["Enums"]["message_channel"]
          contact_id: string
          content: string
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
        }
        Insert: {
          channel?: Database["public"]["Enums"]["message_channel"]
          contact_id: string
          content: string
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
        }
        Update: {
          channel?: Database["public"]["Enums"]["message_channel"]
          contact_id?: string
          content?: string
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "messages_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      sms_logs: {
        Row: {
          business_id: string
          contact_id: string | null
          created_at: string
          error: string | null
          id: string
          message: string
          phone: string
          provider_sid: string | null
          status: string
        }
        Insert: {
          business_id: string
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message: string
          phone: string
          provider_sid?: string | null
          status?: string
        }
        Update: {
          business_id?: string
          contact_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          message?: string
          phone?: string
          provider_sid?: string | null
          status?: string
        }
        Relationships: []
      }
      tags: {
        Row: {
          business_id: string
          created_at: string
          id: string
          name: string
        }
        Insert: {
          business_id: string
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          business_id?: string
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: [
          {
            foreignKeyName: "tags_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      owns_business: { Args: { _business_id: string }; Returns: boolean }
      owns_contact: { Args: { _contact_id: string }; Returns: boolean }
    }
    Enums: {
      automation_action: "send_message" | "add_tag" | "notify_owner"
      automation_trigger: "new_message" | "tag_added" | "time_delay"
      contact_stage: "new" | "interested" | "negotiation" | "paid" | "lost"
      message_channel: "manual" | "whatsapp" | "sms"
      message_direction: "inbound" | "outbound"
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
      automation_action: ["send_message", "add_tag", "notify_owner"],
      automation_trigger: ["new_message", "tag_added", "time_delay"],
      contact_stage: ["new", "interested", "negotiation", "paid", "lost"],
      message_channel: ["manual", "whatsapp", "sms"],
      message_direction: ["inbound", "outbound"],
    },
  },
} as const

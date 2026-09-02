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
      ai_assistant_settings: {
        Row: {
          address: string | null
          business_description: string | null
          business_id: string
          contact_info: string | null
          custom_instructions: string | null
          enabled: boolean
          fallback_message: string | null
          faqs: string | null
          hours: string | null
          products_services: string | null
          strict_knowledge: boolean
          tone: string
          updated_at: string
          website: string | null
        }
        Insert: {
          address?: string | null
          business_description?: string | null
          business_id: string
          contact_info?: string | null
          custom_instructions?: string | null
          enabled?: boolean
          fallback_message?: string | null
          faqs?: string | null
          hours?: string | null
          products_services?: string | null
          strict_knowledge?: boolean
          tone?: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          address?: string | null
          business_description?: string | null
          business_id?: string
          contact_info?: string | null
          custom_instructions?: string | null
          enabled?: boolean
          fallback_message?: string | null
          faqs?: string | null
          hours?: string | null
          products_services?: string | null
          strict_knowledge?: boolean
          tone?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "ai_assistant_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_knowledge_entries: {
        Row: {
          business_id: string
          category: string
          content: string
          created_at: string
          id: string
          is_active: boolean
          keywords: string | null
          priority: number
          title: string
          updated_at: string
        }
        Insert: {
          business_id: string
          category?: string
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string | null
          priority?: number
          title: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          category?: string
          content?: string
          created_at?: string
          id?: string
          is_active?: boolean
          keywords?: string | null
          priority?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_knowledge_entries_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          business_id: string
          created_at: string
          detail: Json
          id: string
          target_id: string | null
          target_type: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          business_id: string
          created_at?: string
          detail?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          business_id?: string
          created_at?: string
          detail?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
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
      business_members: {
        Row: {
          business_id: string
          created_at: string
          display_name: string | null
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["member_role"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          business_id: string
          created_at?: string
          display_name?: string | null
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          business_id?: string
          created_at?: string
          display_name?: string | null
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["member_role"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "business_members_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      business_verifications: {
        Row: {
          business_id: string
          certificate_url: string | null
          created_at: string
          id: string
          legal_name: string | null
          notes: string | null
          owner_id_url: string | null
          status: string
          submitted_at: string | null
          suggested_display_name: string | null
          updated_at: string
        }
        Insert: {
          business_id: string
          certificate_url?: string | null
          created_at?: string
          id?: string
          legal_name?: string | null
          notes?: string | null
          owner_id_url?: string | null
          status?: string
          submitted_at?: string | null
          suggested_display_name?: string | null
          updated_at?: string
        }
        Update: {
          business_id?: string
          certificate_url?: string | null
          created_at?: string
          id?: string
          legal_name?: string | null
          notes?: string | null
          owner_id_url?: string | null
          status?: string
          submitted_at?: string | null
          suggested_display_name?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      businesses: {
        Row: {
          business_hours: Json | null
          created_at: string
          default_greeting: string | null
          id: string
          logo_url: string | null
          messaging_provider: string
          mpesa_number: string | null
          mpesa_type: string | null
          name: string
          onboarded_at: string | null
          owner_id: string
          phone: string | null
        }
        Insert: {
          business_hours?: Json | null
          created_at?: string
          default_greeting?: string | null
          id?: string
          logo_url?: string | null
          messaging_provider?: string
          mpesa_number?: string | null
          mpesa_type?: string | null
          name: string
          onboarded_at?: string | null
          owner_id: string
          phone?: string | null
        }
        Update: {
          business_hours?: Json | null
          created_at?: string
          default_greeting?: string | null
          id?: string
          logo_url?: string | null
          messaging_provider?: string
          mpesa_number?: string | null
          mpesa_type?: string | null
          name?: string
          onboarded_at?: string | null
          owner_id?: string
          phone?: string | null
        }
        Relationships: []
      }
      channel_credentials: {
        Row: {
          business_id: string
          created_at: string
          credentials: Json
          id: string
          is_active: boolean
          provider: string
          updated_at: string
        }
        Insert: {
          business_id: string
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          provider: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          created_at?: string
          credentials?: Json
          id?: string
          is_active?: boolean
          provider?: string
          updated_at?: string
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
          avatar_url: string | null
          business_id: string
          created_at: string
          email: string | null
          gateway_synced_at: string | null
          id: string
          lead_score: number
          lead_score_updated_at: string | null
          name: string
          notes: string | null
          opt_in: boolean
          opt_in_source: string | null
          phone: string
          stage: Database["public"]["Enums"]["contact_stage"]
        }
        Insert: {
          avatar_url?: string | null
          business_id: string
          created_at?: string
          email?: string | null
          gateway_synced_at?: string | null
          id?: string
          lead_score?: number
          lead_score_updated_at?: string | null
          name: string
          notes?: string | null
          opt_in?: boolean
          opt_in_source?: string | null
          phone: string
          stage?: Database["public"]["Enums"]["contact_stage"]
        }
        Update: {
          avatar_url?: string | null
          business_id?: string
          created_at?: string
          email?: string | null
          gateway_synced_at?: string | null
          id?: string
          lead_score?: number
          lead_score_updated_at?: string | null
          name?: string
          notes?: string | null
          opt_in?: boolean
          opt_in_source?: string | null
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
      conversation_labels: {
        Row: {
          conversation_id: string
          created_at: string
          tag_id: string
        }
        Insert: {
          conversation_id: string
          created_at?: string
          tag_id: string
        }
        Update: {
          conversation_id?: string
          created_at?: string
          tag_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "conversation_labels_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "conversations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "conversation_labels_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "tags"
            referencedColumns: ["id"]
          },
        ]
      }
      conversation_notes: {
        Row: {
          author_id: string
          body: string
          business_id: string
          conversation_id: string
          created_at: string
          id: string
        }
        Insert: {
          author_id: string
          body: string
          business_id: string
          conversation_id: string
          created_at?: string
          id?: string
        }
        Update: {
          author_id?: string
          body?: string
          business_id?: string
          conversation_id?: string
          created_at?: string
          id?: string
        }
        Relationships: []
      }
      conversations: {
        Row: {
          assigned_at: string | null
          assigned_by: string | null
          assigned_to: string | null
          business_id: string
          contact_id: string
          created_at: string
          id: string
          last_direction: string | null
          last_inbound_at: string | null
          last_message_at: string
          last_message_preview: string | null
          status: string
          team: string | null
          unread_count: number
        }
        Insert: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          business_id: string
          contact_id: string
          created_at?: string
          id?: string
          last_direction?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          status?: string
          team?: string | null
          unread_count?: number
        }
        Update: {
          assigned_at?: string | null
          assigned_by?: string | null
          assigned_to?: string | null
          business_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          last_direction?: string | null
          last_inbound_at?: string | null
          last_message_at?: string
          last_message_preview?: string | null
          status?: string
          team?: string | null
          unread_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "conversations_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: true
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_settings: {
        Row: {
          api_key: string
          base_url: string
          business_id: string
          business_name: string | null
          created_at: string
          id: string
          is_active: boolean
          last_checked_at: string | null
          updated_at: string
          webhook_registered_at: string | null
          webhook_secret: string | null
          webhook_url: string | null
          whatsapp_connected: boolean
        }
        Insert: {
          api_key: string
          base_url: string
          business_id: string
          business_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          updated_at?: string
          webhook_registered_at?: string | null
          webhook_secret?: string | null
          webhook_url?: string | null
          whatsapp_connected?: boolean
        }
        Update: {
          api_key?: string
          base_url?: string
          business_id?: string
          business_name?: string | null
          created_at?: string
          id?: string
          is_active?: boolean
          last_checked_at?: string | null
          updated_at?: string
          webhook_registered_at?: string | null
          webhook_secret?: string | null
          webhook_url?: string | null
          whatsapp_connected?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "gateway_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      gateway_unmatched_messages: {
        Row: {
          body: string | null
          business_id: string | null
          channel: string | null
          id: string
          payload: Json
          phone: string
          provider_message_id: string | null
          received_at: string
          resolved_at: string | null
        }
        Insert: {
          body?: string | null
          business_id?: string | null
          channel?: string | null
          id?: string
          payload?: Json
          phone: string
          provider_message_id?: string | null
          received_at?: string
          resolved_at?: string | null
        }
        Update: {
          body?: string | null
          business_id?: string | null
          channel?: string | null
          id?: string
          payload?: Json
          phone?: string
          provider_message_id?: string | null
          received_at?: string
          resolved_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "gateway_unmatched_messages_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      inbox_settings: {
        Row: {
          broadcast_rate_per_sec: number
          business_id: string
          close_hour: number
          created_at: string
          mpesa_autotag_enabled: boolean
          open_days: number[]
          open_hour: number
          out_of_hours_enabled: boolean
          out_of_hours_message: string
          timezone: string
          updated_at: string
        }
        Insert: {
          broadcast_rate_per_sec?: number
          business_id: string
          close_hour?: number
          created_at?: string
          mpesa_autotag_enabled?: boolean
          open_days?: number[]
          open_hour?: number
          out_of_hours_enabled?: boolean
          out_of_hours_message?: string
          timezone?: string
          updated_at?: string
        }
        Update: {
          broadcast_rate_per_sec?: number
          business_id?: string
          close_hour?: number
          created_at?: string
          mpesa_autotag_enabled?: boolean
          open_days?: number[]
          open_hour?: number
          out_of_hours_enabled?: boolean
          out_of_hours_message?: string
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "inbox_settings_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: true
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_assignments: {
        Row: {
          assignee_id: string | null
          business_id: string
          contact_id: string
          created_at: string
          dry_run: boolean
          id: string
          reason: string | null
          rule_id: string | null
          score: number | null
        }
        Insert: {
          assignee_id?: string | null
          business_id: string
          contact_id: string
          created_at?: string
          dry_run?: boolean
          id?: string
          reason?: string | null
          rule_id?: string | null
          score?: number | null
        }
        Update: {
          assignee_id?: string | null
          business_id?: string
          contact_id?: string
          created_at?: string
          dry_run?: boolean
          id?: string
          reason?: string | null
          rule_id?: string | null
          score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_assignments_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_assignments_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "routing_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      lead_score_history: {
        Row: {
          breakdown: Json
          business_id: string
          contact_id: string
          created_at: string
          id: string
          new_score: number
          old_score: number
          reason: string | null
        }
        Insert: {
          breakdown?: Json
          business_id: string
          contact_id: string
          created_at?: string
          id?: string
          new_score?: number
          old_score?: number
          reason?: string | null
        }
        Update: {
          breakdown?: Json
          business_id?: string
          contact_id?: string
          created_at?: string
          id?: string
          new_score?: number
          old_score?: number
          reason?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_score_history_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_score_history_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
        ]
      }
      message_delivery_logs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          message_id: string
          provider_status: string | null
          status: string
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          message_id: string
          provider_status?: string | null
          status: string
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          message_id?: string
          provider_status?: string | null
          status?: string
        }
        Relationships: []
      }
      message_templates: {
        Row: {
          body: string
          business_id: string
          category: string | null
          created_at: string
          id: string
          name: string
        }
        Insert: {
          body: string
          business_id: string
          category?: string | null
          created_at?: string
          id?: string
          name: string
        }
        Update: {
          body?: string
          business_id?: string
          category?: string | null
          created_at?: string
          id?: string
          name?: string
        }
        Relationships: []
      }
      messages: {
        Row: {
          channel: Database["public"]["Enums"]["message_channel"]
          contact_id: string
          content: string
          conversation_id: string | null
          created_at: string
          direction: Database["public"]["Enums"]["message_direction"]
          id: string
          media_filename: string | null
          media_mime: string | null
          media_size: number | null
          media_type: string | null
          media_url: string | null
          provider_message_id: string | null
          reactions: Json
          reply_to_provider_id: string | null
        }
        Insert: {
          channel?: Database["public"]["Enums"]["message_channel"]
          contact_id: string
          content: string
          conversation_id?: string | null
          created_at?: string
          direction: Database["public"]["Enums"]["message_direction"]
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_size?: number | null
          media_type?: string | null
          media_url?: string | null
          provider_message_id?: string | null
          reactions?: Json
          reply_to_provider_id?: string | null
        }
        Update: {
          channel?: Database["public"]["Enums"]["message_channel"]
          contact_id?: string
          content?: string
          conversation_id?: string | null
          created_at?: string
          direction?: Database["public"]["Enums"]["message_direction"]
          id?: string
          media_filename?: string | null
          media_mime?: string | null
          media_size?: number | null
          media_type?: string | null
          media_url?: string | null
          provider_message_id?: string | null
          reactions?: Json
          reply_to_provider_id?: string | null
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
      onboarding_sessions: {
        Row: {
          business_id: string
          completed_at: string | null
          created_at: string
          data: Json
          id: string
          path: string | null
          step: string
          updated_at: string
        }
        Insert: {
          business_id: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          id?: string
          path?: string | null
          step?: string
          updated_at?: string
        }
        Update: {
          business_id?: string
          completed_at?: string | null
          created_at?: string
          data?: Json
          id?: string
          path?: string | null
          step?: string
          updated_at?: string
        }
        Relationships: []
      }
      payment_transactions: {
        Row: {
          amount: number
          business_id: string
          created_at: string
          currency: string
          id: string
          meta: Json
          provider: string
          provider_ref: string | null
          purpose: string
          status: string
          updated_at: string
        }
        Insert: {
          amount: number
          business_id: string
          created_at?: string
          currency?: string
          id?: string
          meta?: Json
          provider: string
          provider_ref?: string | null
          purpose: string
          status?: string
          updated_at?: string
        }
        Update: {
          amount?: number
          business_id?: string
          created_at?: string
          currency?: string
          id?: string
          meta?: Json
          provider?: string
          provider_ref?: string | null
          purpose?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          bucket: string
          count: number
          key: string
          window_start: string
        }
        Insert: {
          bucket: string
          count?: number
          key: string
          window_start: string
        }
        Update: {
          bucket?: string
          count?: number
          key?: string
          window_start?: string
        }
        Relationships: []
      }
      reminders: {
        Row: {
          business_id: string
          contact_id: string
          created_at: string
          created_by: string
          due_at: string
          id: string
          note: string | null
          status: string
        }
        Insert: {
          business_id: string
          contact_id: string
          created_at?: string
          created_by: string
          due_at: string
          id?: string
          note?: string | null
          status?: string
        }
        Update: {
          business_id?: string
          contact_id?: string
          created_at?: string
          created_by?: string
          due_at?: string
          id?: string
          note?: string | null
          status?: string
        }
        Relationships: []
      }
      revenue_entries: {
        Row: {
          amount: number
          business_id: string
          contact_id: string | null
          created_at: string
          currency: string
          id: string
          note: string | null
          occurred_at: string
        }
        Insert: {
          amount: number
          business_id: string
          contact_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          occurred_at?: string
        }
        Update: {
          amount?: number
          business_id?: string
          contact_id?: string | null
          created_at?: string
          currency?: string
          id?: string
          note?: string | null
          occurred_at?: string
        }
        Relationships: []
      }
      routing_action_runs: {
        Row: {
          action: string
          business_id: string
          contact_id: string
          created_at: string
          dedupe_key: string
          detail: string | null
          id: string
          payload: Json
          processed_at: string | null
          rule_id: string | null
          scheduled_at: string
          status: string
        }
        Insert: {
          action: string
          business_id: string
          contact_id: string
          created_at?: string
          dedupe_key: string
          detail?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          rule_id?: string | null
          scheduled_at?: string
          status?: string
        }
        Update: {
          action?: string
          business_id?: string
          contact_id?: string
          created_at?: string
          dedupe_key?: string
          detail?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          rule_id?: string | null
          scheduled_at?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "routing_action_runs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_action_runs_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "routing_action_runs_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "routing_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      routing_rules: {
        Row: {
          assign_strategy: string
          assign_to_user_id: string | null
          business_id: string
          create_task: boolean
          created_at: string
          dry_run: boolean
          id: string
          is_active: boolean
          max_score: number
          message_body: string | null
          min_score: number
          name: string
          priority: number
          send_message: boolean
          stages: string[]
          task_hours: number
          task_note: string | null
          team: string | null
          updated_at: string
        }
        Insert: {
          assign_strategy?: string
          assign_to_user_id?: string | null
          business_id: string
          create_task?: boolean
          created_at?: string
          dry_run?: boolean
          id?: string
          is_active?: boolean
          max_score?: number
          message_body?: string | null
          min_score?: number
          name: string
          priority?: number
          send_message?: boolean
          stages?: string[]
          task_hours?: number
          task_note?: string | null
          team?: string | null
          updated_at?: string
        }
        Update: {
          assign_strategy?: string
          assign_to_user_id?: string | null
          business_id?: string
          create_task?: boolean
          created_at?: string
          dry_run?: boolean
          id?: string
          is_active?: boolean
          max_score?: number
          message_body?: string | null
          min_score?: number
          name?: string
          priority?: number
          send_message?: boolean
          stages?: string[]
          task_hours?: number
          task_note?: string | null
          team?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "routing_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      scoring_rules: {
        Row: {
          business_id: string
          config: Json
          created_at: string
          description: string | null
          id: string
          is_active: boolean
          key: string
          name: string
          updated_at: string
          weight: number
        }
        Insert: {
          business_id: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key: string
          name: string
          updated_at?: string
          weight?: number
        }
        Update: {
          business_id?: string
          config?: Json
          created_at?: string
          description?: string | null
          id?: string
          is_active?: boolean
          key?: string
          name?: string
          updated_at?: string
          weight?: number
        }
        Relationships: [
          {
            foreignKeyName: "scoring_rules_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
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
      virtual_numbers: {
        Row: {
          business_id: string | null
          created_at: string
          id: string
          phone_number: string
          price_kes: number
          provider: string
          provider_sub_account: string | null
          purchased_at: string | null
          status: string
          updated_at: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          id?: string
          phone_number: string
          price_kes?: number
          provider?: string
          provider_sub_account?: string | null
          purchased_at?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          id?: string
          phone_number?: string
          price_kes?: number
          provider?: string
          provider_sub_account?: string | null
          purchased_at?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      webhook_logs: {
        Row: {
          business_id: string | null
          created_at: string
          error: string | null
          id: string
          payload: Json
          processed_at: string | null
          signature_ok: boolean
          source: string
        }
        Insert: {
          business_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          signature_ok?: boolean
          source: string
        }
        Update: {
          business_id?: string | null
          created_at?: string
          error?: string | null
          id?: string
          payload?: Json
          processed_at?: string | null
          signature_ok?: boolean
          source?: string
        }
        Relationships: []
      }
      whatsapp_business_accounts: {
        Row: {
          access_token: string | null
          business_id: string
          business_name: string
          created_at: string
          id: string
          meta: Json
          phone_number_id: string
          status: string
          updated_at: string
          waba_id: string
        }
        Insert: {
          access_token?: string | null
          business_id: string
          business_name: string
          created_at?: string
          id?: string
          meta?: Json
          phone_number_id: string
          status?: string
          updated_at?: string
          waba_id: string
        }
        Update: {
          access_token?: string | null
          business_id?: string
          business_name?: string
          created_at?: string
          id?: string
          meta?: Json
          phone_number_id?: string
          status?: string
          updated_at?: string
          waba_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_business_accounts_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_connections: {
        Row: {
          business_id: string
          connected_at: string | null
          created_at: string
          disconnected_at: string | null
          display_name: string | null
          id: string
          meta: Json
          phone_number: string
          phone_number_id: string | null
          quality_rating: string | null
          status: string
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          business_id: string
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          display_name?: string | null
          id?: string
          meta?: Json
          phone_number: string
          phone_number_id?: string | null
          quality_rating?: string | null
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          business_id?: string
          connected_at?: string | null
          created_at?: string
          disconnected_at?: string | null
          display_name?: string | null
          id?: string
          meta?: Json
          phone_number?: string
          phone_number_id?: string | null
          quality_rating?: string | null
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: []
      }
      whatsapp_template_sync_logs: {
        Row: {
          business_id: string
          created_at: string
          error: string | null
          id: string
          status: string
          synced_count: number
        }
        Insert: {
          business_id: string
          created_at?: string
          error?: string | null
          id?: string
          status: string
          synced_count?: number
        }
        Update: {
          business_id?: string
          created_at?: string
          error?: string | null
          id?: string
          status?: string
          synced_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_template_sync_logs_business_id_fkey"
            columns: ["business_id"]
            isOneToOne: false
            referencedRelation: "businesses"
            referencedColumns: ["id"]
          },
        ]
      }
      whatsapp_templates: {
        Row: {
          business_account_id: string
          business_id: string
          category: string | null
          components: Json
          created_at: string
          id: string
          language: string
          last_synced_at: string
          meta_template_id: string | null
          name: string
          status: string
          updated_at: string
          waba_id: string | null
        }
        Insert: {
          business_account_id: string
          business_id: string
          category?: string | null
          components?: Json
          created_at?: string
          id?: string
          language: string
          last_synced_at?: string
          meta_template_id?: string | null
          name: string
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Update: {
          business_account_id?: string
          business_id?: string
          category?: string | null
          components?: Json
          created_at?: string
          id?: string
          language?: string
          last_synced_at?: string
          meta_template_id?: string | null
          name?: string
          status?: string
          updated_at?: string
          waba_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "whatsapp_templates_business_account_id_fkey"
            columns: ["business_account_id"]
            isOneToOne: false
            referencedRelation: "whatsapp_business_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "whatsapp_templates_business_id_fkey"
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
      business_performance_metrics: {
        Args: { _business_id: string }
        Returns: {
          avg_response_minutes: number
          contacts_paid: number
          contacts_total: number
          response_pairs: number
          revenue_entries_count: number
          revenue_total: number
        }[]
      }
      can_write_business: { Args: { _business_id: string }; Returns: boolean }
      can_write_contact: { Args: { _contact_id: string }; Returns: boolean }
      can_write_conversation: {
        Args: { _conversation_id: string }
        Returns: boolean
      }
      claim_membership: { Args: never; Returns: undefined }
      ensure_default_scoring_rules: {
        Args: { _business_id: string }
        Returns: undefined
      }
      is_business_member: { Args: { _business_id: string }; Returns: boolean }
      member_of_contact: { Args: { _contact_id: string }; Returns: boolean }
      member_of_conversation: {
        Args: { _conversation_id: string }
        Returns: boolean
      }
      my_business_role: { Args: { _business_id: string }; Returns: string }
      owns_business: { Args: { _business_id: string }; Returns: boolean }
      owns_contact: { Args: { _contact_id: string }; Returns: boolean }
      rate_limit_check: {
        Args: {
          _bucket: string
          _key: string
          _limit: number
          _window_seconds: number
        }
        Returns: boolean
      }
      recalc_all_lead_scores: { Args: never; Returns: number }
      recalc_business_lead_scores: {
        Args: { _business_id: string; _reason?: string }
        Returns: number
      }
      recalc_lead_score: {
        Args: { _contact_id: string; _reason?: string }
        Returns: number
      }
      route_lead: { Args: { _contact_id: string }; Returns: string }
    }
    Enums: {
      automation_action:
        | "send_message"
        | "add_tag"
        | "notify_owner"
        | "send_template"
      automation_trigger:
        | "new_message"
        | "tag_added"
        | "time_delay"
        | "keyword_match"
        | "out_of_hours"
        | "first_message"
        | "reminder_due"
      contact_stage: "new" | "interested" | "negotiation" | "paid" | "lost"
      member_role: "admin" | "agent" | "viewer"
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
      automation_action: [
        "send_message",
        "add_tag",
        "notify_owner",
        "send_template",
      ],
      automation_trigger: [
        "new_message",
        "tag_added",
        "time_delay",
        "keyword_match",
        "out_of_hours",
        "first_message",
        "reminder_due",
      ],
      contact_stage: ["new", "interested", "negotiation", "paid", "lost"],
      member_role: ["admin", "agent", "viewer"],
      message_channel: ["manual", "whatsapp", "sms"],
      message_direction: ["inbound", "outbound"],
    },
  },
} as const

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

// Virtual number provisioning server fns.
// Backed by `virtual_numbers` + `payment_transactions`. The real M-Pesa STK
// push + Africa's Talking number-provisioning calls fire once the master
// account creds are saved in channel_credentials. Until then we simulate
// success so the UX is end-to-end testable.

export const listAvailableNumbers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase } = context;
    const { data } = await supabase
      .from("virtual_numbers")
      .select("id,phone_number,price_kes,status")
      .eq("status", "available")
      .order("phone_number")
      .limit(10);
    return { numbers: data ?? [] };
  });

export const reserveAndPayForNumber = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        numberId: z.string().uuid(),
        mpesaPhone: z.string().trim().min(9).max(15),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: biz } = await supabase.from("businesses").select("id").limit(1).single();
    if (!biz) throw new Error("Business not found");

    // Reserve the number
    const { data: number, error: nErr } = await supabase
      .from("virtual_numbers")
      .update({ status: "reserved", business_id: biz.id })
      .eq("id", data.numberId)
      .eq("status", "available")
      .select()
      .single();
    if (nErr || !number) throw new Error("Number no longer available");

    // Create the payment transaction (STK push would happen here once
    // Daraja creds are present in channel_credentials).
    const { data: tx, error: tErr } = await supabase
      .from("payment_transactions")
      .insert({
        business_id: biz.id,
        amount: number.price_kes,
        currency: "KES",
        provider: "mpesa",
        purpose: "number_purchase",
        status: "pending",
        meta: { mpesa_phone: data.mpesaPhone, number_id: number.id },
      })
      .select()
      .single();
    if (tErr) throw new Error(tErr.message);
    return { transaction: tx, number };
  });

export const confirmNumberPurchase = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({ transactionId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: tx, error } = await supabase
      .from("payment_transactions")
      .update({ status: "success" })
      .eq("id", data.transactionId)
      .select()
      .single();
    if (error) throw new Error(error.message);
    const numberId = (tx.meta as { number_id?: string })?.number_id;
    if (numberId) {
      await supabase
        .from("virtual_numbers")
        .update({ status: "active", purchased_at: new Date().toISOString() })
        .eq("id", numberId);
    }
    return { ok: true };
  });

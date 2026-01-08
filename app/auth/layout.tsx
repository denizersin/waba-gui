import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { LanguageSwitcher } from "@/components/language-switcher";

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  // Check if user is already authenticated
  const { data: { user }, error } = await supabase.auth.getUser();

  // If user is authenticated, redirect to protected page
  if (!error && user) {
    redirect("/protected");
  }

  return (
    <div className="min-h-screen bg-background relative">
      <div className="absolute top-4 right-4">
        <LanguageSwitcher />
      </div>
      {children}
    </div>
  );
}
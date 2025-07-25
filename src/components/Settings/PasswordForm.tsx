"use client"

import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import * as z from "zod"
import { useState } from "react"
import { Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { useSession } from "@/components/Auth/SessionContextProvider"
import { useLanguage } from "@/context/LanguageContext"
import { showSuccess, showError } from "@/utils/toast"

const PasswordForm = () => {
  const { supabase } = useSession()
  const { t } = useLanguage()
  const [isLoading, setIsLoading] = useState(false)

  const formSchema = z.object({
    newPassword: z.string().min(6, { message: t('passwordMinLength') }),
    confirmPassword: z.string(),
  }).refine((data) => data.newPassword === data.confirmPassword, {
    message: t('passwordsDoNotMatch'),
    path: ["confirmPassword"],
  })

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      newPassword: "",
      confirmPassword: "",
    },
  })

  async function onSubmit(values: z.infer<typeof formSchema>) {
    setIsLoading(true)
    const { error } = await supabase.auth.updateUser({
      password: values.newPassword,
    })

    if (error) {
      showError(`${t('passwordUpdateFailed')}: ${error.message}`)
    } else {
      showSuccess(t('passwordUpdateSuccess'))
      form.reset()
    }
    setIsLoading(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('changePassword')}</CardTitle>
        <CardDescription>{t('changePasswordDescription')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="newPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('newPassword')}</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="confirmPassword"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('confirmNewPassword')}</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <Button type="submit" disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {t('changePassword')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  )
}

export default PasswordForm
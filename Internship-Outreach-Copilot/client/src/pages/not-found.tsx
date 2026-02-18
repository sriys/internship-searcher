import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md text-center border-none shadow-xl bg-white/80 backdrop-blur">
        <CardContent className="pt-10 pb-10">
          <div className="flex justify-center mb-6">
            <AlertCircle className="h-16 w-16 text-primary opacity-20" />
          </div>
          <h1 className="text-4xl font-display font-bold text-gray-900 mb-4">404</h1>
          <p className="text-lg text-gray-600 mb-8">
            The page you're looking for doesn't exist.
          </p>
          <Link href="/">
            <Button className="w-full sm:w-auto px-8" size="lg">
              Return Home
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

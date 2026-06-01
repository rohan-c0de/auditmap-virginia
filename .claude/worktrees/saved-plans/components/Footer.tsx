import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-900 mt-auto">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-sm text-gray-500 dark:text-slate-400">
            © {new Date().getFullYear()} Community College Path. Free course finder for community college students.
          </p>
          <nav className="flex items-center gap-6 text-sm text-gray-500 dark:text-slate-400">
            <Link href="/about" className="hover:text-teal-600 transition-colors">
              About
            </Link>
            <Link href="/blog" className="hover:text-teal-600 transition-colors">
              Blog
            </Link>
            <Link href="/contact" className="hover:text-teal-600 transition-colors">
              Contact
            </Link>
            <Link href="/privacy" className="hover:text-teal-600 transition-colors">
              Privacy
            </Link>
          </nav>
        </div>
      </div>
    </footer>
  );
}

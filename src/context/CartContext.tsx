"use client";

import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import type { CartItem } from "@/lib/data";
import { trackAddToCart } from "@/lib/analytics";

type CartContextType = {
  cart: CartItem[];
  addToCart: (item: CartItem) => void;
  updateQty: (index: number, qty: number) => void;
  removeFromCart: (index: number) => void;
  clearCart: () => void;
  cartCount: number;
  cartTotal: number;
};

const CartContext = createContext<CartContextType | null>(null);

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Load cart from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem("cadieux_cart");
      if (saved) setCart(JSON.parse(saved));
    } catch {}
    setHydrated(true);
  }, []);

  // Persist cart to localStorage whenever it changes
  useEffect(() => {
    if (hydrated) localStorage.setItem("cadieux_cart", JSON.stringify(cart));
  }, [cart, hydrated]);

  function addToCart(item: CartItem) {
    trackAddToCart(item);
    setCart(prev => {
      // Subscriptions are unique per schedule — always append a new line
      // so two different subscription configs aren't merged together.
      if (item.orderType === "sub") {
        return [...prev, item];
      }
      const idx = prev.findIndex(
        c => c.productIndex === item.productIndex && c.orderType === item.orderType
      );
      if (idx >= 0) {
        const updated = [...prev];
        updated[idx] = { ...updated[idx], qty: updated[idx].qty + item.qty };
        return updated;
      }
      return [...prev, item];
    });
  }

  function updateQty(index: number, qty: number) {
    setCart(prev => prev.map((item, i) => (i === index ? { ...item, qty } : item)));
  }

  function removeFromCart(index: number) {
    setCart(prev => prev.filter((_, i) => i !== index));
  }

  const cartCount = cart.reduce((s, c) => s + c.qty, 0);
  const cartTotal = cart.reduce((s, c) => s + c.price * c.qty, 0);

  return (
    <CartContext.Provider
      value={{
        cart,
        addToCart,
        updateQty,
        removeFromCart,
        clearCart: () => setCart([]),
        cartCount,
        cartTotal,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart must be used within CartProvider");
  return ctx;
}

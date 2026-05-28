import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    
    // Set initial value without triggering the rule directly in the body
    const updateMobileState = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    
    updateMobileState();
    
    mql.addEventListener("change", updateMobileState)
    return () => mql.removeEventListener("change", updateMobileState)
  }, [])

  return !!isMobile
}

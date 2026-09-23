import { BrowserRouter, Route, Routes } from "react-router"
import { BoardView } from "@/pages/BoardView"
import { Home } from "@/pages/Home"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/games/:id" element={<BoardView />} />
      </Routes>
    </BrowserRouter>
  )
}

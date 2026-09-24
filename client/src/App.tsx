import { BrowserRouter, Route, Routes } from "react-router"
import { BoardView } from "@/pages/BoardView"
import { Home } from "@/pages/Home"
import { EventBoards } from "@/pages/EventBoards"
import { RoundPage } from "@/pages/RoundPage"

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/games/:id" element={<BoardView />} />
        <Route path="/events/:tournamentId" element={<EventBoards />} />
        <Route path="/rounds/:roundId" element={<RoundPage />} />
      </Routes>
    </BrowserRouter>
  )
}

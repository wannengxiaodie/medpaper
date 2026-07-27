import { Routes, Route } from 'react-router'
import Home from './pages/Home'
import Workspace from './pages/Workspace'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/workspace" element={<Workspace />} />
    </Routes>
  )
}

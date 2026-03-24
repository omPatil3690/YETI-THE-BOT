import React from "react";
import { render, screen } from "@testing-library/react";
import App from "./App";

test("renders the widget title", () => {
  render(<App />);
  expect(screen.getByText(/youtube video bot/i)).toBeInTheDocument();
});

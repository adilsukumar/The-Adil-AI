import tkinter as tk
from tkinter import ttk

QUESTIONS = [
    {
        "q": "1. What is the powerhouse of the cell?",
        "options": ["Nucleus", "Ribosome", "Mitochondria", "Golgi Apparatus"],
        "answer": 2,
    },
    {
        "q": "2. Which programming language is widely known for machine learning?",
        "options": ["Python", "PHP", "HTML", "Cobol"],
        "answer": 0,
    },
    {
        "q": "3. What is the chemical symbol for Gold?",
        "options": ["Ag", "Au", "Fe", "Pb"],
        "answer": 1,
    },
    {
        "q": "4. Who wrote the play 'Romeo and Juliet'?",
        "options": ["Charles Dickens", "William Shakespeare", "Mark Twain", "Jane Austen"],
        "answer": 1,
    },
    {
        "q": "5. What is the speed of light in vacuum approximately?",
        "options": ["300,000 km/s", "150,000 km/s", "30,000 km/s", "3,000,000 km/s"],
        "answer": 0,
    },
]


class QuizSimulatorApp:
    def __init__(self, root):
        self.root = root
        self.root.title("MCQ Quiz Simulator (Practice App for Adil AI)")
        self.root.geometry("620x460")
        self.root.configure(bg="#F1F5F9")
        self.root.attributes("-topmost", True)

        self.current_idx = 0
        self.selected_var = tk.IntVar(value=-1)

        # Style
        self.header = tk.Label(
            root,
            text="Online Practice Exam",
            font=("Segoe UI", 16, "bold"),
            bg="#2563EB",
            fg="white",
            pady=12,
        )
        self.header.pack(fill="x")

        # Card Frame
        self.card = tk.Frame(root, bg="white", padx=24, pady=20, relief="groove", bd=1)
        self.card.pack(fill="both", expand=True, padx=20, pady=16)

        # Question text
        self.q_label = tk.Label(
            self.card,
            text="",
            font=("Segoe UI", 13, "bold"),
            bg="white",
            fg="#0F172A",
            wraplength=540,
            justify="left",
        )
        self.q_label.pack(anchor="w", pady=(0, 16))

        # Radio options
        self.radio_buttons = []
        for i in range(4):
            rb = tk.Radiobutton(
                self.card,
                text="",
                variable=self.selected_var,
                value=i,
                font=("Segoe UI", 11),
                bg="white",
                fg="#334155",
                activebackground="white",
                highlightthickness=0,
                command=self.on_option_selected,
            )
            rb.pack(anchor="w", pady=6)
            self.radio_buttons.append(rb)

        # Status and Next button
        self.footer = tk.Frame(root, bg="#F1F5F9", padx=20, pady=10)
        self.footer.pack(fill="x")

        self.status_label = tk.Label(
            self.footer,
            text="Waiting for your answer...",
            font=("Segoe UI", 10, "italic"),
            bg="#F1F5F9",
            fg="#64748B",
        )
        self.status_label.pack(side="left")

        self.next_btn = ttk.Button(self.footer, text="Next Question", command=self.load_next_question)
        self.next_btn.pack(side="right")

        self.load_question(self.current_idx)

    def load_question(self, idx):
        self.selected_var.set(-1)
        data = QUESTIONS[idx]
        self.q_label.config(text=data["q"])
        letters = ["A", "B", "C", "D"]
        for i, opt in enumerate(data["options"]):
            self.radio_buttons[i].config(text=f"({letters[i]})  {opt}")
        self.status_label.config(text=f"Question {idx + 1} of {len(QUESTIONS)}", fg="#64748B")

    def on_option_selected(self):
        val = self.selected_var.get()
        correct = QUESTIONS[self.current_idx]["answer"]
        if val == correct:
            self.status_label.config(text="Option selected! Click 'Next Question' or wait.", fg="#16A34A")
        else:
            self.status_label.config(text="Option selected.", fg="#2563EB")

    def load_next_question(self):
        self.current_idx = (self.current_idx + 1) % len(QUESTIONS)
        self.load_question(self.current_idx)


if __name__ == "__main__":
    root = tk.Tk()
    app = QuizSimulatorApp(root)
    root.mainloop()


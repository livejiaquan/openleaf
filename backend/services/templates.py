"""
新項目範本（對齊 Overleaf 的 New Project 範本選擇）。

每個範本是「相對路徑 → 內容」的檔案集合，main.tex 為主文件。
範本內容以 XeLaTeX 可直接編譯為準。
"""

BLANK_TEMPLATE = {
    "main.tex": r"""\documentclass{article}

\title{Untitled}
\author{}
\date{\today}

\begin{document}

\maketitle

\section{Introduction}

Start writing here.

\end{document}
""",
}

ARTICLE_TEMPLATE = {
    "main.tex": r"""\documentclass[11pt]{article}

\usepackage{amsmath, amssymb}
\usepackage{graphicx}
\usepackage{booktabs}
\usepackage{hyperref}

\title{Article Title}
\author{Author Name}
\date{\today}

\begin{document}

\maketitle

\begin{abstract}
A short summary of the article.
\end{abstract}

\section{Introduction}

Introduce the problem and cite related work~\cite{example2024}.

\section{Method}

Describe the method. Inline math like $E = mc^2$ and display math:
\begin{equation}
    \hat{y} = \arg\max_{c} \; p(c \mid x)
    \label{eq:argmax}
\end{equation}

\section{Results}

Refer to Equation~\ref{eq:argmax} and summarize findings.

\section{Conclusion}

Conclude the article.

\bibliographystyle{plain}
\bibliography{refs}

\end{document}
""",
    "refs.bib": r"""@article{example2024,
  title   = {An Example Reference},
  author  = {Doe, Jane and Smith, John},
  journal = {Journal of Examples},
  year    = {2024},
  volume  = {1},
  pages   = {1--10}
}
""",
}

ARTICLE_ZH_TEMPLATE = {
    "main.tex": r"""\documentclass{article}

% 支援中文
\usepackage{xeCJK}
\setCJKmainfont{PingFang SC}  % macOS 預設中文字型

% 其他常用套件
\usepackage{amsmath}
\usepackage{graphicx}
\usepackage{hyperref}

\title{中文文件標題}
\author{作者}
\date{\today}

\begin{document}

\maketitle

\section{簡介}

這是一個新建的 LaTeX 文件。開始編輯吧！

\section{範例}

這裡可以寫一些數學公式：

\begin{equation}
    E = mc^2
\end{equation}

或者插入圖片、表格等。

\end{document}
""",
}

BEAMER_TEMPLATE = {
    "main.tex": r"""\documentclass{beamer}

\usetheme{Madrid}
\usecolortheme{default}

\title{Presentation Title}
\subtitle{Subtitle}
\author{Author Name}
\institute{Institute}
\date{\today}

\begin{document}

\frame{\titlepage}

\begin{frame}{Outline}
    \tableofcontents
\end{frame}

\section{Introduction}

\begin{frame}{Introduction}
    \begin{itemize}
        \item First point
        \item Second point
        \item Third point
    \end{itemize}
\end{frame}

\section{Main Content}

\begin{frame}{A Two-Column Slide}
    \begin{columns}
        \column{0.5\textwidth}
            Left column text.
        \column{0.5\textwidth}
            Right column text.
    \end{columns}
\end{frame}

\section{Conclusion}

\begin{frame}{Conclusion}
    Key takeaway message.
\end{frame}

\end{document}
""",
}

CV_TEMPLATE = {
    "main.tex": r"""\documentclass[11pt]{article}

\usepackage[margin=2cm]{geometry}
\usepackage{enumitem}
\usepackage{hyperref}
\pagestyle{empty}

\newcommand{\sectionrule}[1]{\vspace{6pt}\noindent\textbf{\large #1}\\[2pt]\hrule\vspace{6pt}}

\begin{document}

\begin{center}
    {\LARGE \textbf{Your Name}}\\[4pt]
    City, Country \quad | \quad \href{mailto:you@example.com}{you@example.com} \quad | \quad +886\,912\,345\,678
\end{center}

\sectionrule{Education}
\noindent\textbf{University Name} \hfill 2022 -- 2026\\
B.S. in Computer Science

\sectionrule{Experience}
\noindent\textbf{Company Name} --- Software Engineering Intern \hfill 2025\\
\begin{itemize}[leftmargin=1.2em, topsep=2pt, itemsep=2pt]
    \item Built a feature that improved X by Y\%.
    \item Collaborated with a team of N people.
\end{itemize}

\sectionrule{Skills}
\noindent Programming: Python, TypeScript, C++\\
Tools: Git, Docker, \LaTeX

\sectionrule{Awards}
\noindent Example Award, Example Organization \hfill 2024

\end{document}
""",
}

PROJECT_TEMPLATES: dict[str, dict[str, str]] = {
    "blank": BLANK_TEMPLATE,
    "article": ARTICLE_TEMPLATE,
    "article-zh": ARTICLE_ZH_TEMPLATE,
    "beamer": BEAMER_TEMPLATE,
    "cv": CV_TEMPLATE,
}

DEFAULT_TEMPLATE = "blank"

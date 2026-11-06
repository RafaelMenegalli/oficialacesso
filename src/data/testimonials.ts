/**
 * Testimonials transcribed verbatim from design/testimonials-reference.png.
 * Do not "fix" spelling or punctuation — it is the customers' own writing.
 *
 * Structure mirrors the reference: top-level comments, each with optional
 * threaded replies.
 */
export interface Testimonial {
  id: string;
  name: string;
  text: string;
  /** Profile photo under /public (square). Falls back to initials when absent. */
  avatar?: string;
  /** Like count shown on the original comment. */
  likes: number;
  /**
   * Relative time as shown in the screenshot ("1 h"). Kept for reference but
   * not rendered: a frozen "1 h" would become untrue the moment it's shipped.
   */
  postedAgo: string;
  replies?: Testimonial[];
}

export const testimonials: Testimonial[] = [
  {
    id: "aline-ribeiro",
    avatar: "/assets/testimonials/aline-ribeiro.png",
    name: "Aline Ribeiro",
    text: "Façam pq funciona !! Fiz por volta das 14h e as 19h ele estava na minha casa , chega me surpreendi quando ouvi o “tava com saudade sabia ?” . Gratidão universo !!!",
    likes: 13,
    postedAgo: "1 h",
    replies: [
      {
        id: "helen-maria",
        avatar: "/assets/testimonials/helen-maria.png",
        name: "Helen Maria",
        text: "Voltei para dizer que funcionou SIM…. eu fiz as 3:00 madrugada domingo e na segunda as 01:30 ele mandou mensagem e ele é bem orgulhoso…marrento ..",
        likes: 8,
        postedAgo: "1 h",
      },
      {
        id: "luana-beatriz",
        avatar: "/assets/testimonials/luana-beatriz.png",
        name: "Luana Beatriz",
        text: "Voltando aqui pra dar o meu testemunho. eu assisti o vídeo hj e em seguida eu fiz a simpatia e deu muito certo. Nós estávamos afastado, já fazia uns dias q ele tava me tratando com indiferença ai eu fiz simpatia de manhã e agora a noite ele ligou louco de sdds e fazendo declarações de amor gratidão ao universo",
        likes: 3,
        postedAgo: "1 h",
      },
    ],
  },
  {
    id: "vitor-felipe",
    avatar: "/assets/testimonials/vitor-felipe.png",
    name: "Vitor Felipe",
    text: "fiz esse ritual hoje e ela me mandou mensagem faça com fé gratidão",
    likes: 13,
    postedAgo: "9 h",
  },
];

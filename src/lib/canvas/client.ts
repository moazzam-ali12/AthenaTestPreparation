export interface CanvasCourse {
  id: number;
  name: string;
  course_code: string;
  enrollment_term_id: number;
}

export interface CanvasAssignment {
  id: number;
  name: string;
  points_possible: number;
  submission_types: string[];
}

export interface CanvasUser {
  id: number;
  name: string;
  primary_email: string;
}

export class CanvasApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(`Canvas API error ${statusCode}: ${message}`);
    this.name = "CanvasApiError";
  }
}

export class CanvasClient {
  constructor(
    private baseUrl: string,
    private accessToken: string,
  ) {}

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new CanvasApiError(res.status, text);
    }

    return res.json() as Promise<T>;
  }

  async getCurrentUser(): Promise<CanvasUser> {
    return this.request<CanvasUser>("/users/self/profile");
  }

  async getCourses(): Promise<CanvasCourse[]> {
    return this.request<CanvasCourse[]>(
      "/courses?per_page=50&enrollment_type=student&state[]=active"
    );
  }

  async getAssignments(courseId: string): Promise<CanvasAssignment[]> {
    return this.request<CanvasAssignment[]>(
      `/courses/${courseId}/assignments?per_page=50&order_by=due_at`
    );
  }

  async submitAssignment(
    courseId: string,
    assignmentId: string,
    htmlBody: string,
  ): Promise<void> {
    await this.request(`/courses/${courseId}/assignments/${assignmentId}/submissions`, {
      method: "POST",
      body: JSON.stringify({
        submission: {
          submission_type: "online_text_entry",
          body: htmlBody,
        },
      }),
    });
  }

  // Requires instructor/teacher permissions — used only when CANVAS_INSTRUCTOR_TOKEN is set
  async postGrade(
    courseId: string,
    assignmentId: string,
    canvasUserId: string,
    grade: string,
  ): Promise<void> {
    await this.request(
      `/courses/${courseId}/assignments/${assignmentId}/submissions/${canvasUserId}`,
      {
        method: "PUT",
        body: JSON.stringify({ submission: { posted_grade: grade } }),
      }
    );
  }
}

export function createCanvasClient(baseUrl: string, accessToken: string): CanvasClient {
  return new CanvasClient(baseUrl.replace(/\/+$/, ""), accessToken);
}

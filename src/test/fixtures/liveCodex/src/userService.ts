export interface User {
	id: string;
	active: boolean;
	country: string;
	score: number;
}

export function getTopUsers(users: User[], limit = 10): User[] {
	if (limit <= 0) {
		return [];
	}

	return users
		.filter((user) => user.active && user.country === 'US')
		.sort((left, right) => right.score - left.score)
		.slice(0, limit);
}
